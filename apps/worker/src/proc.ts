import { spawn } from 'node:child_process';

/**
 * Exécute un outil externe de façon isolée : sans shell, environnement minimal,
 * délai maximal et sortie bornée. (En production, exécuter le worker dans un conteneur dédié.)
 */
export function run(cmd: string, args: string[], opts: { timeoutMs: number; cwd?: string; input?: NodeJS.ReadableStream } ): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: opts.cwd ?? '/tmp', LANG: 'C.UTF-8' },
    });
    let stdout = '', stderr = '';
    const cap = (s: string, d: Buffer) => (s.length < 1_000_000 ? s + d.toString() : s);
    child.stdout.on('data', (d) => { stdout = cap(stdout, d); });
    child.stderr.on('data', (d) => { stderr = cap(stderr, d); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} : délai dépassé (${opts.timeoutMs / 1000} s)`)); }, opts.timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`${cmd} indisponible : ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} a échoué (code ${code}) : ${stderr.slice(-500)}`));
    });
    if (opts.input) opts.input.pipe(child.stdin); else child.stdin.end();
  });
}
