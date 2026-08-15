export default function LeemoSwitch({
  checked,
  onCheckedChange,
  disabled = false,
  label,
  className = "",
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-state={checked ? "checked" : "unchecked"}
      onClick={() => onCheckedChange(!checked)}
      className={`leemo-switch relative inline-flex h-[18px] w-[30px] shrink-0 items-center overflow-hidden rounded-full transition-[background-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-focus-ring,var(--leemo-amber-line))] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${
        checked
          ? "bg-[var(--leemo-accent-strong,var(--leemo-amber))] shadow-[inset_0_0_0_1px_rgba(122,65,7,0.10)]"
          : "bg-[var(--leemo-control-track,#dfe3e8)] shadow-[inset_0_0_0_1px_var(--leemo-line-2)]"
      } ${className}`}
    >
      <span
        aria-hidden="true"
        data-testid="leemo-switch-thumb"
        data-side={checked ? "right" : "left"}
        className={`block h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.20)] transition-transform duration-150 ease-out ${checked ? "translate-x-[14px]" : "translate-x-[2px]"}`}
      />
    </button>
  );
}
