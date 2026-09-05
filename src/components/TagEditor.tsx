import { useState } from 'react';

interface Props {
  tags: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
}

export default function TagEditor({ tags, suggestions, onChange }: Props) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setDraft('');
  };

  return (
    <div className="tag-editor">
      {tags.map((tag) => (
        <span className="tag-chip static" key={tag}>
          {tag}
          <button
            className="tag-remove"
            aria-label={`Remove tag ${tag}`}
            onClick={() => onChange(tags.filter((t) => t !== tag))}
          >
            ×
          </button>
        </span>
      ))}

      <input
        className="tag-input"
        value={draft}
        list="tag-suggestions"
        placeholder="+ tag"
        aria-label="Add a tag"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && draft === '' && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => draft && add(draft)}
      />

      <datalist id="tag-suggestions">
        {suggestions.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </div>
  );
}
