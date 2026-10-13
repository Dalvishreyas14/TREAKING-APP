/**
 * Stand-in for the `server-only` package, used only by the test runner.
 *
 * Empty on purpose: the real module exists to make importing a server module
 * from a client component a build error, which is enforced by the bundler, not
 * by anything in this file.
 */
export {};
