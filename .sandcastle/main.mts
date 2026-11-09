// Parallel Planner with Review — four-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An opus agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2 (Execute + Review): For each issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (100 iterations). If it produces commits, a
//                               reviewer runs in the same sandbox on the same
//                               branch (1 iteration). All issue pipelines run
//                               concurrently via Promise.allSettled().
//   Phase 3 (Merge):            A single agent merges all branches that passed
//                               review into the checked-out branch (main or an
//                               experiment), then the host pushes that branch.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of merges.
//
// Usage:
//   npx tsx .sandcastle/main.mts
// Or add to package.json:
//   "scripts": { "sandcastle": "npx tsx .sandcastle/main.mts" }

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

// The planner emits its plan as JSON inside <plan> tags; Output.object extracts
// and validates it against this schema. We use Zod here, but any Standard
// Schema validator works just as well — Valibot, ArkType, etc. See
// https://standardschema.dev.
const planSchema = z.object({
  issues: z.array(
    z.object({ id: z.string(), title: z.string(), branch: z.string() }),
  ),
});

// The reviewer's verdict decides whether a branch may be merged.
const reviewSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  reason: z.string(),
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of plan→execute→merge cycles before stopping.
// Raise this if your backlog is large; lower it for a quick smoke-test run.
const MAX_ITERATIONS = 10;

// Hooks run inside the sandbox before the agent starts each iteration.
// npm install ensures the sandbox always has fresh dependencies.
const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install" }] },
};

// Copy node_modules from the host into the worktree before each sandbox
// starts. Avoids a full npm install from scratch; the hook above handles
// platform-specific binaries and any packages added since the last copy.
const copyToWorktree = ["node_modules"];

// The checked-out branch plays the role of "main" for this run: implementation
// branches fork from it, merge back into it, and only it gets pushed. Its label
// is what keeps each run to its own tickets.
const { stdout: currentBranch } = await run("git", ["branch", "--show-current"]);
const TARGET_BRANCH = currentBranch.trim();

const readyLabelFor = (branch: string) => {
  if (branch === "main") return "ready-for-agent";
  if (!/^experiment\/[A-Za-z0-9._-]+$/.test(branch)) {
    throw new Error(`Run Sandcastle from main or experiment/<issue>-<slug>, not "${branch}".`);
  }
  const label = `ready-${branch}`;
  if (label.length > 50) {
    throw new Error(`Label "${label}" exceeds GitHub's 50 characters. Use a shorter branch name.`);
  }
  return label;
};
const READY_LABEL = readyLabelFor(TARGET_BRANCH);

const REPO = "yaakov-belch-lab/0001-domain-language-grill-with-docs-first-glossary";
const REMOTE_URL = `git@github.com:${REPO}.git`;

// sandbox.run() has no `output` option, so read the verdict from stdout. A
// missing or invalid verdict throws, so the branch isn't merged.
const parseReview = (stdout: string) => {
  const last = [...stdout.matchAll(/<review>([\s\S]*?)<\/review>/g)].at(-1);
  if (!last?.[1]) throw new Error("Reviewer gave no <review> verdict.");
  return reviewSchema.parse(JSON.parse(last[1]));
};

// Hand a rejected issue to a human, so that the next round doesn't retry it.
const blockIssue = async (id: string, reason: string) => {
  await run("gh", ["issue", "comment", id, "--repo", REPO, "--body",
    `Sandcastle review failed, so this branch was not merged:\n\n${reason}`]);
  await run("gh", ["issue", "edit", id, "--repo", REPO,
    "--remove-label", READY_LABEL, "--add-label", "ready-for-human"]);
};

// Runs on the host, and agents can write to .git through the bind mount. So
// use a fixed URL, and ignore any hooks or ssh command they may have planted.
// Never forced: if origin has moved on, the push fails and the run stops.
const pushTargetBranch = async () => {
  await run("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.sshCommand=ssh",
    "push", REMOTE_URL, `${TARGET_BRANCH}:refs/heads/${TARGET_BRANCH}`]);
  await run("git", ["update-ref", `refs/remotes/origin/${TARGET_BRANCH}`, TARGET_BRANCH]);
};

const branchCommit = async (branch: string) => {
  const { stdout } = await run("git", ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);
  return stdout.trim();
};

const isMerged = (commit: string) =>
  run("git", ["merge-base", "--is-ancestor", commit, TARGET_BRANCH]).then(
    () => true,
    () => false,
  );

console.log(`Target branch: ${TARGET_BRANCH}\nTicket label: ${READY_LABEL}`);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // -------------------------------------------------------------------------
  // Phase 1: Plan
  //
  // The planning agent (opus, for deeper reasoning) reads the open issue list,
  // builds a dependency graph, and selects the issues that can be worked in
  // parallel right now (i.e., no blocking dependencies on other open issues).
  //
  // It outputs a <plan> JSON block — Output.object parses and validates it.
  // -------------------------------------------------------------------------
  const plan = await sandcastle.run({
    hooks,
    sandbox: docker(),
    name: "planner",
    // One iteration is enough: the planner just needs to read and reason,
    // not write code. (Structured output requires maxIterations: 1.)
    maxIterations: 1,
    // Opus for planning: dependency analysis benefits from deeper reasoning.
    agent: sandcastle.claudeCode("claude-opus-5-5"),
    promptFile: "./.sandcastle/plan-prompt.md",
    promptArgs: { READY_LABEL, REPO },
    // Extract and validate the <plan> JSON into a typed object. Throws
    // StructuredOutputError if the tag is missing, the JSON is malformed, or
    // validation fails — which aborts the loop.
    output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
  });

  const issues = plan.output.issues;

  if (issues.length === 0) {
    // No unblocked work — either everything is done or everything is blocked.
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute + Review
  //
  // For each issue, create a sandbox via createSandbox() so the implementer
  // and reviewer share the same sandbox instance per branch. The implementer
  // runs first; if it produces commits, the reviewer runs in the same sandbox.
  //
  // Promise.allSettled means one failing pipeline doesn't cancel the others.
  // -------------------------------------------------------------------------

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      const sandbox = await sandcastle.createSandbox({
        branch: issue.branch,
        sandbox: docker(),
        hooks,
        copyToWorktree,
      });

      try {
        // Run the implementer
        const implement = await sandbox.run({
          name: "implementer",
          maxIterations: 100,
          agent: sandcastle.claudeCode("claude-opus-5-5"),
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: {
            REPO,
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });

        // Only review if the implementer produced commits
        if (implement.commits.length > 0) {
          const review = await sandbox.run({
            name: "reviewer",
            maxIterations: 1,
            agent: sandcastle.claudeCode("claude-opus-5-5"),
            promptFile: "./.sandcastle/review-prompt.md",
            promptArgs: {
              BRANCH: issue.branch,
            },
          });
          const verdict = parseReview(review.stdout);

          // A failed review reports no commits, which keeps it out of the
          // merge phase below. The branch itself stays for a human to inspect.
          if (verdict.verdict === "fail") {
            console.error(`  ✗ ${issue.id} failed review: ${verdict.reason}`);
            await blockIssue(issue.id, verdict.reason);
            return { commits: [] };
          }

          // Merge commits from both runs so the merge phase sees all of them.
          // Each sandbox.run() only returns commits from its own run.
          return {
            ...review,
            commits: [...implement.commits, ...review.commits],
          };
        }

        return implement;
      } finally {
        await sandbox.close();
      }
    }),
  );

  // Log any agents that threw (network error, sandbox crash, etc.), and
  // only pass branches that actually produced commits to the merge phase.
  // An agent that ran successfully but made no commits has nothing to merge.
  const completedIssues: typeof issues = [];
  for (const [i, issue] of issues.entries()) {
    const outcome = settled[i];
    if (outcome?.status === "rejected") {
      console.error(
        `  ✗ ${issue.id} (${issue.branch}) failed: ${outcome.reason}`,
      );
    } else if (
      outcome?.status === "fulfilled" &&
      outcome.value.commits.length > 0
    ) {
      completedIssues.push(issue);
    }
  }

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with commits:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    // All agents ran but none made commits — nothing to merge this cycle.
    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge
  //
  // One agent merges all completed branches into the current branch,
  // resolving any conflicts and running tests to confirm everything works.
  //
  // The {{BRANCHES}} and {{ISSUES}} prompt arguments are lists that the agent
  // uses to know which branches to merge and which issues to close.
  // -------------------------------------------------------------------------
  // Record each branch's commit first. The merger may delete a merged branch,
  // and the check below shouldn't depend on anything the agent can change.
  const approvedCommits = await Promise.all(completedBranches.map(branchCommit));

  const merge = await sandcastle.run({
    hooks,
    sandbox: docker(),
    name: "merger",
    maxIterations: 1,
    agent: sandcastle.claudeCode("claude-opus-5-5"),
    promptFile: "./.sandcastle/merge-prompt.md",
    promptArgs: {
      REPO,
      // A markdown list of branch names, one per line.
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      // A markdown list of issue IDs and titles, one per line.
      ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
    },
  });

  // -------------------------------------------------------------------------
  // Push only if the merger reports success and git confirms every approved
  // commit is in the target branch. Otherwise stop, and leave the result for a
  // human.
  // -------------------------------------------------------------------------
  const merged = await Promise.all(approvedCommits.map(isMerged));
  const unmerged = completedBranches.filter((_, i) => !merged[i]);
  if (merge.completionSignal === undefined || unmerged.length > 0) {
    throw new Error(
      `Merge incomplete, so nothing was pushed. Not merged: ${unmerged.join(", ") || "(none, but the merger did not report success)"}`,
    );
  }

  await pushTargetBranch();
  console.log(`\nBranches merged and pushed to ${TARGET_BRANCH}.`);
}

console.log("\nAll done.");
