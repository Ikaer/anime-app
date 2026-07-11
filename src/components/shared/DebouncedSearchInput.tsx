import React, { useEffect, useRef, useState } from 'react';

interface DebouncedSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  debounceMs?: number;
}

/**
 * A text input whose value is buffered locally and only pushed to `onChange`
 * after `debounceMs` of inactivity. Needed because `onChange` here ultimately
 * drives a `router.push` (URL state), which is async - binding the input
 * directly to that round-tripped value causes React to reassign `node.value`
 * on every keystroke's resolution, which resets the caret to the end whenever
 * the edit wasn't at the end of the string (e.g. backspacing or inserting a
 * space mid-string).
 */
const DebouncedSearchInput: React.FC<DebouncedSearchInputProps> = ({
  value,
  onChange,
  placeholder,
  className,
  debounceMs = 300,
}) => {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleChange = (next: string) => {
    setLocal(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(next), debounceMs);
  };

  return (
    <input
      type="text"
      placeholder={placeholder}
      value={local}
      onChange={(e) => handleChange(e.target.value)}
      className={className}
    />
  );
};

export default DebouncedSearchInput;
