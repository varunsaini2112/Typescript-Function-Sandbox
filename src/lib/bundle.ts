import { compile, detectImports } from './compile';
import type { MethodDoc, ModuleSource } from '../types';

export class BundleError extends Error {
  /** Whether the graph could not be resolved, or a member of it failed to compile. */
  readonly kind: 'resolve' | 'compile';

  constructor(message: string, kind: 'resolve' | 'compile') {
    super(message);
    this.name = 'BundleError';
    this.kind = kind;
  }
}

/** `./slugify`, `slugify.ts`, `../slugify` all resolve to the method named `slugify`. */
export function normalizeSpecifier(specifier: string): string {
  return specifier
    .replace(/^\.{1,2}\//, '')
    .replace(/\.(ts|js|tsx|jsx|mts|cts)$/, '')
    .trim();
}

function findMethod(methods: MethodDoc[], specifier: string): MethodDoc | undefined {
  const wanted = normalizeSpecifier(specifier).toLowerCase();
  return methods.find((method) => method.name.trim().toLowerCase() === wanted);
}

/**
 * Compile a method together with everything it imports, in dependency order.
 *
 * Throws BundleError for a missing module or an import cycle, so those surface
 * as clear messages rather than a confusing runtime failure inside the worker.
 */
export function buildModuleGraph(
  entry: MethodDoc,
  methods: MethodDoc[],
  preamble: string,
): ModuleSource[] {
  const prefix = preamble.trim() === '' ? '' : `${preamble}\n`;
  // Lines the prefix pushes the method down by — i.e. newlines in the prefix,
  // so the method's own line 1 lands at combined line preambleLines + 1.
  const preambleLines = prefix ? (prefix.match(/\n/g)?.length ?? 0) : 0;

  const ordered: ModuleSource[] = [];
  const done = new Set<string>();
  const visiting: string[] = [];

  const visit = (method: MethodDoc) => {
    const key = method.id;
    if (done.has(key)) return;

    if (visiting.includes(key)) {
      const cycle = [...visiting.slice(visiting.indexOf(key)), key]
        .map((id) => methods.find((m) => m.id === id)?.name ?? id)
        .join(' → ');
      throw new BundleError(`Import cycle: ${cycle}`, 'resolve');
    }
    visiting.push(key);

    for (const specifier of detectImports(method.code)) {
      const dependency = findMethod(methods, specifier);
      if (!dependency) {
        throw new BundleError(
          `"${method.name}" imports "${specifier}", which does not match any method in this workspace.`,
          'resolve',
        );
      }
      if (dependency.id === method.id) {
        throw new BundleError(`"${method.name}" imports itself.`, 'resolve');
      }
      visit(dependency);
    }

    visiting.pop();
    done.add(key);

    const { js, map, errors } = compile(prefix + method.code, `${method.name}.ts`);
    if (errors.length) {
      throw new BundleError(`${method.name}: ${errors.join('\n')}`, 'compile');
    }

    ordered.push({ name: method.name, js, map, preambleLines });
  };

  visit(entry);
  return ordered;
}
