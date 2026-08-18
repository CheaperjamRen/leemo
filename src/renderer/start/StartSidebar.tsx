import { START_NAVIGATION, type StartDestination } from "./start-navigation";

const SECTION_LABELS = {
  primary: "开始",
  library: "资料",
  system: "管理",
} as const;

export default function StartSidebar({
  destination,
  collapsed,
  mobileOpen,
  onOpen,
}: {
  destination: StartDestination;
  collapsed: boolean;
  mobileOpen: boolean;
  onOpen(destination: StartDestination): void;
}) {
  return (
    <aside className={`leemo-start-sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-mobile-open" : ""}`}>
      <nav aria-label="开始导航">
        {(Object.keys(SECTION_LABELS) as Array<keyof typeof SECTION_LABELS>).map((section) => (
          <section key={section}>
            <p>{SECTION_LABELS[section]}</p>
            {START_NAVIGATION.filter((item) => item.section === section).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={destination === item.id ? "page" : undefined}
                  aria-label={item.label}
                  title={collapsed ? item.label : undefined}
                  onClick={() => onOpen(item.id)}
                >
                  <Icon aria-hidden />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </section>
        ))}
      </nav>
    </aside>
  );
}
