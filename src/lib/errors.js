export class AutomifyError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AutomifyError";
    if (options.cause) this.cause = options.cause;
  }
}

export class SafetyCheckError extends AutomifyError {
  constructor(checks, action) {
    super("Computer-use returned pending safety checks that were not acknowledged.");
    this.name = "SafetyCheckError";
    this.checks = checks;
    this.action = action;
  }
}

export class MaxStepsExceededError extends AutomifyError {
  constructor(maxSteps) {
    super(`Computer-use exceeded the configured maxSteps limit of ${maxSteps}.`);
    this.name = "MaxStepsExceededError";
    this.maxSteps = maxSteps;
  }
}
