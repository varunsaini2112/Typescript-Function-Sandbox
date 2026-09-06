import Menu, { MenuItem } from './Menu';
import SaveIndicator, { type SaveState } from './SaveIndicator';
import { CUE_SETS } from '../lib/sound';
import type { CueSet } from '../lib/sound';
import type { ThemePref, Workspace } from '../types';

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: '◐ Follow system' },
  { value: 'light', label: '☀ Light' },
  { value: 'dark', label: '☾ Dark' },
];

interface Props {
  workspace: Workspace;
  saveState: SaveState;
  selectedName: string | null;
  runningAll: boolean;
  runAllRef: React.RefObject<HTMLButtonElement>;
  onRunAll: () => void;
  onExportMethod: () => void;
  onExportWorkspace: () => void;
  onImport: () => void;
  onAddExamples: () => void;
  onReset: () => void;
  onPatch: (patch: Partial<Workspace>) => void;
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--accent)" />
      <path
        d="M6.5 9 L9.5 12 L6.5 15"
        fill="none"
        stroke="var(--accent-text)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.5 15.5 H17.5" stroke="var(--accent-text)" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Grouped so the eye lands on the one action that matters. Everything else is
 * either a menu or a setting — a flat row of eight equal buttons read as noise.
 */
export default function TopBar({
  workspace,
  saveState,
  selectedName,
  runningAll,
  runAllRef,
  onRunAll,
  onExportMethod,
  onExportWorkspace,
  onImport,
  onAddExamples,
  onReset,
  onPatch,
}: Props) {
  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <strong>TS Sandbox</strong>
        <SaveIndicator state={saveState} />
      </div>

      <div className="topbar-actions">
        <button
          ref={runAllRef}
          className="btn primary run-all"
          onClick={onRunAll}
          disabled={runningAll || workspace.methods.length === 0}
        >
          {runningAll ? 'Running…' : '▶ Run all tests'}
        </button>

        <Menu label="Export ▾" title="Export">
          {(close) => (
            <>
              <MenuItem
                label="This method (.ts)"
                hint={selectedName ? `${selectedName}.ts — code, tests and settings` : 'no method selected'}
                disabled={!selectedName}
                onClick={() => {
                  close();
                  onExportMethod();
                }}
              />
              <MenuItem
                label="Whole workspace (.json)"
                hint="every method plus the preamble — your backup"
                onClick={() => {
                  close();
                  onExportWorkspace();
                }}
              />
            </>
          )}
        </Menu>

        <Menu label="⋯" title="More actions" className="icon-btn">
          {(close) => (
            <>
              <MenuItem
                label="Import…"
                hint="a method (.ts) or a workspace (.json)"
                onClick={() => {
                  close();
                  onImport();
                }}
              />
              <MenuItem
                label="Add examples"
                hint="bundled methods you do not have yet"
                onClick={() => {
                  close();
                  onAddExamples();
                }}
              />
              <MenuItem
                label="Reset workspace"
                hint="replace everything with the examples"
                danger
                onClick={() => {
                  close();
                  onReset();
                }}
              />
            </>
          )}
        </Menu>

        <Menu label="⚙" title="Settings" className="icon-btn">
          {() => (
            <>
              <div className="menu-group">
                <span className="menu-group-title">Theme</span>
                {THEMES.map((theme) => (
                  <MenuItem
                    key={theme.value}
                    label={`${workspace.theme === theme.value ? '✓ ' : '  '}${theme.label}`}
                    onClick={() => onPatch({ theme: theme.value })}
                  />
                ))}
              </div>

              <div className="menu-group">
                <span className="menu-group-title">Sound</span>
                <MenuItem
                  label={workspace.sound ? '✓ On' : '  Off'}
                  hint="cues when a run finishes"
                  onClick={() => onPatch({ sound: !workspace.sound })}
                />
                {CUE_SETS.map((set) => (
                  <MenuItem
                    key={set.value}
                    label={`${workspace.cueSet === set.value ? '✓ ' : '  '}${set.label}`}
                    hint={set.hint}
                    disabled={!workspace.sound}
                    onClick={() => onPatch({ cueSet: set.value as CueSet })}
                  />
                ))}
              </div>

              <div className="menu-group">
                <span className="menu-group-title">Running</span>
                <MenuItem
                  label={`${workspace.blockRunOnTypeError ? '✓ ' : '  '}Block on type errors`}
                  hint="refuse to run a method that does not type-check"
                  onClick={() => onPatch({ blockRunOnTypeError: !workspace.blockRunOnTypeError })}
                />
              </div>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}
