# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `npm run typecheck` and `npm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, close its issue using the following command:

`gh issue close <ID> --repo {{REPO}} --comment "Completed by Sandcastle"`

Here are all the issues:

{{ISSUES}}

Only close the issues if all branches are merged and the checks below pass.

# FINISH

Run `npm run typecheck` and `npm run test` once more after the last merge. A missing script counts as passing.

The result is pushed to GitHub automatically if you signal success, so output <promise>COMPLETE</promise> only if every branch is merged and the checks pass. Otherwise, explain what went wrong and do not output that signal.
