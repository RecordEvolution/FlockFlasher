// Pure argv helpers, free of Electron/Node-runtime imports so they can be
// unit-tested (see args.test.ts). Keeping the sudo argv construction here — and
// never a shell string — is what prevents argument/command injection into
// privileged commands.

/**
 * Build the argv for a `sudo` invocation that runs `command` with exactly the
 * given `args`. Each element of `args` stays a single argument to `command`, so
 * spaces, quotes and shell metacharacters inside an argument can never be
 * re-split into extra arguments or interpreted as shell syntax.
 *
 * `-E` preserves the environment, `-S` reads the password from stdin.
 */
export const buildSudoArgs = (command: string, args: string[] = []): string[] => {
  return ['-E', '-S', command, ...args]
}
