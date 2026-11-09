# TASK

Review the code changes on branch `{{BRANCH}}` and improve code clarity, consistency, and maintainability while preserving exact functionality.

# CONTEXT

## Branch diff

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

# REVIEW PROCESS

1. **Understand the change**: Read the diff and commits above to understand the intent.

2. **Analyze for improvements**: Look for opportunities to:
   - Reduce unnecessary complexity and nesting
   - Eliminate redundant code and abstractions
   - Improve readability through clear variable and function names
   - Consolidate related logic
   - Remove unnecessary comments that describe obvious code
   - Avoid nested ternary operators - prefer switch statements or if/else chains
   - Choose clarity over brevity - explicit code is often better than overly compact code

3. **Check correctness**:
   - Does the implementation match the intent? Are edge cases handled?
   - Are new/changed behaviours covered by tests?
   - Are there unsafe casts, `any` types, or unchecked assumptions?
   - Does the change introduce injection vulnerabilities, credential leaks, or other security issues?

4. **Maintain balance**: Avoid over-simplification that could:
   - Reduce code clarity or maintainability
   - Create overly clever solutions that are hard to understand
   - Combine too many concerns into single functions or components
   - Remove helpful abstractions that improve code organization
   - Make the code harder to debug or extend

5. **Apply project standards**: Follow the coding standards defined in @CODING_STANDARDS.md, and the domain vocabulary in @GLOSSARY.md

6. **Preserve functionality**: Never change what the code does - only how it does it. All original features, outputs, and behaviors must remain intact.

# EXECUTION

If you find improvements to make:

1. Make the changes directly on this branch
2. Run tests and type checking to ensure nothing is broken
3. Commit describing the refinements

If the code is already clean and well-structured, do nothing.

# VERDICT

Finish by deciding whether this branch may be merged into {{TARGET_BRANCH}}. Nobody else checks it before the merge.

Fail it if, after your refinements, any of these remain:

- It doesn't do what its commits and issue intend, or has a bug you can't safely fix without changing behaviour.
- It has a security problem, such as injection or a leaked credential.
- A test or type check fails.
- New or changed behaviour has no tests, when the project has a test setup.

A missing `typecheck` or `test` npm script is not a failure on its own. Style issues you could not fix are not failures either.

Output your verdict as JSON wrapped in `<review>` tags, with a reason a human can act on:

<review>
{"verdict": "pass", "reason": "Matches the issue; tests pass."}
</review>

The verdict must be either `pass` or `fail`.
