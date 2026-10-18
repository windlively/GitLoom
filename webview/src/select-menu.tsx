import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Check, ChevronDown } from './icons';

export type SelectOption = {
  value: string;
  label: string;
  title?: string;
  disabled?: boolean;
  separator?: boolean;
};

type Placement = { left: number; top: number; width: number; maxHeight: number };

const MARGIN = 8;
const GAP = 4;
const MAX_HEIGHT = 320;

export function SelectMenu({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  disabled = false,
  className = '',
  menuMinWidth = 200,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  menuMinWidth?: number;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const typeahead = useRef<{ query: string; timer: ReturnType<typeof setTimeout> | null }>({
    query: '',
    timer: null,
  });
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const selected = options.find((option) => option.value === value);

  const place = useCallback(() => {
    const panel = popup.current;
    const anchor = trigger.current;
    if (!panel || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const width = Math.min(Math.max(rect.width, menuMinWidth), viewportWidth - MARGIN * 2);
    panel.style.width = `${width}px`;
    panel.style.maxHeight = 'none';
    const naturalHeight = panel.getBoundingClientRect().height;
    const belowSpace = viewportHeight - rect.bottom - GAP - MARGIN;
    const aboveSpace = rect.top - GAP - MARGIN;
    const placeBelow = naturalHeight <= belowSpace || belowSpace >= aboveSpace;
    const maxHeight = Math.max(48, Math.min(MAX_HEIGHT, placeBelow ? belowSpace : aboveSpace));
    const height = Math.min(naturalHeight, maxHeight);
    const top = placeBelow ? rect.bottom + GAP : Math.max(MARGIN, rect.top - GAP - height);
    const left = Math.max(MARGIN, Math.min(rect.left, viewportWidth - width - MARGIN));
    setPlacement({ left, top, width, maxHeight });
  }, [menuMinWidth]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    place();
  }, [open, place]);

  useLayoutEffect(() => {
    if (!open || !placement) return;
    const panel = popup.current!;
    const initial =
      panel.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]:not(:disabled)') ||
      panel.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)');
    initial?.focus({ preventScroll: true });
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popup.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
    };
    const scroll = (event: Event) => {
      if (popup.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open, place]);

  useEffect(
    () => () => {
      if (typeahead.current.timer) clearTimeout(typeahead.current.timer);
    },
    [],
  );

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    close(true);
    if (option.value !== value) onChange(option.value);
  };

  const moveFocus = (delta: number | 'first' | 'last', event?: ReactKeyboardEvent) => {
    const panel = popup.current;
    if (!panel) return;
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')];
    if (!buttons.length) return;
    event?.preventDefault();
    if (delta === 'first') {
      buttons[0].focus();
      return;
    }
    if (delta === 'last') {
      buttons[buttons.length - 1].focus();
      return;
    }
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      index < 0 ? (delta > 0 ? 0 : buttons.length - 1) : (index + delta + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      moveFocus(event.key === 'ArrowDown' ? 1 : -1, event);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      moveFocus(event.key === 'Home' ? 'first' : 'last', event);
      return;
    }
    if (event.key.length !== 1 || event.key === ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
    const state = typeahead.current;
    state.query += event.key.toLowerCase();
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.query = '';
      state.timer = null;
    }, 600);
    const match = [
      ...(popup.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') || []),
    ].find((button) => (button.dataset.label || '').toLowerCase().startsWith(state.query));
    if (match) {
      event.preventDefault();
      match.focus();
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`select-trigger${className ? ` ${className}` : ''}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          if (open) close(true);
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          const selectedButton = popup.current?.querySelector<HTMLButtonElement>(
            '[role="option"][aria-selected="true"]:not(:disabled)',
          );
          selectedButton?.focus();
        }}
      >
        <span className="select-value">{selected?.label ?? placeholder ?? value}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          ref={popup}
          id={listId}
          className="select-popup"
          role="listbox"
          aria-label={ariaLabel}
          style={{
            left: placement?.left ?? MARGIN,
            top: placement?.top ?? 0,
            width: placement?.width,
            maxHeight: placement?.maxHeight,
            visibility: placement ? 'visible' : 'hidden',
          }}
          onKeyDown={onKeyDown}
        >
          {options.map((option, index) => (
            <Fragment key={`${option.value}-${index}`}>
              {option.separator && <div role="separator" className="select-separator" />}
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className="select-option"
                disabled={option.disabled}
                title={option.title || option.label}
                data-label={option.label}
                onPointerEnter={(event) => event.currentTarget.focus({ preventScroll: true })}
                onClick={() => choose(option)}
              >
                <span className="select-option-label">{option.label}</span>
                {option.value === value && <Check size={14} />}
              </button>
            </Fragment>
          ))}
          {!options.length && <div className="select-empty">没有可用选项</div>}
        </div>
      )}
    </>
  );
}
