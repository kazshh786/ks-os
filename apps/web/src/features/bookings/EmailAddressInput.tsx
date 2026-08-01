import { useMemo, useState } from 'react';
import { Mail } from 'lucide-react';

const commonDomains = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'];

type EmailAddressInputProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

export function EmailAddressInput({ value, onChange, className = '' }: EmailAddressInputProps) {
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(() => {
    const clean = value.trim().toLowerCase();
    if (!clean || clean.includes(' ') || clean.indexOf('@') !== clean.lastIndexOf('@')) return [];
    const [local, domain = ''] = clean.split('@');
    if (!local) return [];
    return commonDomains
      .filter(item => item.startsWith(domain))
      .map(item => `${local}@${item}`)
      .filter(item => item !== clean)
      .slice(0, 5);
  }, [value]);

  const open = focused && suggestions.length > 0;
  const choose = (suggestion: string) => {
    onChange(suggestion);
    setActiveIndex(0);
  };

  return (
    <div className="email-suggestion-field">
      <div className="email-suggestion-field__control">
        <Mail aria-hidden="true" />
        <input
          required
          type="email"
          autoComplete="email"
          inputMode="email"
          value={value}
          onChange={event => {
            onChange(event.target.value);
            setActiveIndex(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={event => {
            if (!open) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex(index => (index + 1) % suggestions.length);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex(index => (index - 1 + suggestions.length) % suggestions.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(suggestions[activeIndex] || suggestions[0]);
            } else if (event.key === 'Escape') {
              setFocused(false);
            }
          }}
          placeholder="name@gmail.com"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="popular-email-suggestions"
          aria-activedescendant={open ? `email-suggestion-${activeIndex}` : undefined}
          className={className}
        />
      </div>
      {open ? (
        <ul id="popular-email-suggestions" role="listbox" className="email-suggestion-field__menu">
          {suggestions.map((suggestion, index) => (
            <li
              id={`email-suggestion-${index}`}
              key={suggestion}
              role="option"
              aria-selected={index === activeIndex}
            >
              <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => choose(suggestion)}>
                <span>{suggestion.split('@')[0]}</span><strong>@{suggestion.split('@')[1]}</strong>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="email-suggestion-field__hint">We will send your confirmation and secure booking link here.</p>
    </div>
  );
}

export default EmailAddressInput;
