# Security Policy

`automify` can control browsers, execute shell commands, and integrate with native computer adapters. Treat every automation session as privileged code execution.

## Recommendations

- Use dedicated test accounts and isolated browser contexts.
- Configure `allowedDomains` for browser automation.
- Keep CLI `approval: "always"` unless your command policy is narrow and well tested.
- Use `allowedCommands` and `blockedCommands` for CLI automation.
- Keep `maxSteps` bounded.
- Redact screenshots before they are sent to OpenAI when pages may contain sensitive information.
- Do not automate payments, destructive administrative actions, or private user data without explicit human approval.

## Reporting Issues

Open a private security advisory in the repository if available, or contact the maintainers through the repository issue tracker with minimal reproduction details.
