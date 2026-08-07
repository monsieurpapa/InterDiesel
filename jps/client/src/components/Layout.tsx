import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Menu, X, ChevronDown } from "lucide-react";
import { NAV_GROUPS, accentStyle, colorForPath, type NavGroupConfig } from "../config/modules";
import { useAuth } from "../auth/AuthContext";
import { canAccess } from "../config/permissions";

const COLLAPSED_STORAGE_KEY = "jps.nav.collapsed";

function findCurrentLabel(pathname: string): string {
  for (const group of NAV_GROUPS) {
    for (const link of group.links) {
      if (link.to === "/" ? pathname === "/" : pathname.startsWith(link.to)) {
        return link.label;
      }
    }
  }
  return "";
}

function groupForPath(pathname: string): NavGroupConfig | undefined {
  return NAV_GROUPS.find((group) =>
    group.links.some((l) => (l.to === "/" ? pathname === "/" : pathname.startsWith(l.to))),
  );
}

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function initials(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const currentLabel = findCurrentLabel(location.pathname);
  const visibleGroups = NAV_GROUPS.filter((group) => user && canAccess(user.role, group.module));

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Le groupe de la page en cours ne reste jamais replié malgré lui — si
  // l'utilisateur l'avait fermé, on le rouvre en arrivant dessus.
  useEffect(() => {
    const active = groupForPath(location.pathname);
    if (active && collapsed.has(active.title)) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(active.title);
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
        return next;
      });
    }
    setMobileOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  function toggleGroup(title: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  async function handleLogout() {
    await logout();
    navigate("/connexion", { replace: true });
  }

  return (
    <div className="app-shell">
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}

      <aside className={"sidebar" + (mobileOpen ? " sidebar-open" : "")}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-row">
            <div className="sidebar-brand-mark">JPS</div>
            <div>
              <div className="sidebar-brand-name">JPS DIEU MERCI</div>
              <div className="sidebar-brand-subtitle">Transport &amp; Distribution</div>
            </div>
            <button
              className="sidebar-close-btn"
              onClick={() => setMobileOpen(false)}
              aria-label="Fermer le menu"
            >
              <X size={18} />
            </button>
          </div>
          <span className="sidebar-location-badge">Bunia · Ituri</span>
        </div>

        <nav className="sidebar-nav">
          {visibleGroups.map((group) => {
            const isCollapsed = collapsed.has(group.title);
            return (
              <div key={group.title} className="nav-group" style={accentStyle(group.color)}>
                <button
                  type="button"
                  className="nav-group-title"
                  onClick={() => toggleGroup(group.title)}
                  aria-expanded={!isCollapsed}
                >
                  <span>{group.title}</span>
                  <ChevronDown size={14} className={"nav-group-chevron" + (isCollapsed ? " collapsed" : "")} />
                </button>
                <div className={"nav-group-links" + (isCollapsed ? " collapsed" : "")}>
                  {group.links.map((link) => {
                    const Icon = link.icon;
                    return (
                      <NavLink
                        key={link.to}
                        to={link.to}
                        end={link.to === "/"}
                        className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                      >
                        <Icon size={17} strokeWidth={2} />
                        {link.label}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {user && (
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <div className="sidebar-user-avatar">{initials(user.nom)}</div>
              <div>
                <div className="sidebar-user-name">{user.nom}</div>
                <div className="sidebar-user-role">{user.roleLabel}</div>
              </div>
            </div>
            <button className="sidebar-logout-btn" onClick={handleLogout} title="Se déconnecter">
              <LogOut size={16} />
            </button>
          </div>
        )}
      </aside>

      <div className="content">
        <div className="topbar">
          <button
            className="hamburger-btn"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu size={20} />
          </button>
          <span>JPS Dieu Merci</span>
          {currentLabel && (
            <>
              <span>›</span>
              <span className="topbar-crumb-current">{currentLabel}</span>
            </>
          )}
        </div>
        <div style={accentStyle(colorForPath(location.pathname))}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
