/**
 * Terminal output.
 *
 * No dependency: colour is a handful of escape codes and a TTY check. Honouring
 * `NO_COLOR` and a non-TTY stdout matters because `fleetscope watch` output is
 * routinely piped into a log during a demo.
 */
/** Written as an escape rather than a literal so this file stays greppable. */
const ESC = '\u001b[';

const enabled =
  process.stdout.isTTY === true &&
  process.env['NO_COLOR'] === undefined &&
  process.env['TERM'] !== 'dumb';

const wrap =
  (code: string) =>
  (text: string): string =>
    enabled ? `${ESC}${code}m${text}${ESC}0m` : text;

export const bold = wrap('1');
export const dim = wrap('2');
export const blue = wrap('38;5;33');
export const green = wrap('32');
export const red = wrap('31');
export const yellow = wrap('33');

export const line = (text = ''): void => {
  process.stdout.write(`${text}\n`);
};

export const errorLine = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

export const ready = (label: string): void => line(`${green('●')} ${label}`);
export const pending = (label: string): void => line(`${dim('○')} ${label}`);

/** A problem the developer can act on: what happened, then what to do. */
export const fail = (what: string, remedy?: string): void => {
  errorLine(`${red('✗')} ${what}`);
  if (remedy !== undefined) errorLine(`  ${dim(remedy)}`);
};
