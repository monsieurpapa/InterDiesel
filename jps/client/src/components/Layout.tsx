import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { NAV_GROUPS, accentStyle, colorForPath } from "../config/modules";
import { useAuth } from "../auth/AuthContext";
import { canAccess } from "../config/permissions";

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

  async function handleLogout() {
    await logout();
    navigate("/connexion", { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-row">
            <div className="sidebar-brand-mark">JPS</div>
            <div>
              <div className="sidebar-brand-name">JPS DIEU MERCI</div>
              <div className="sidebar-brand-subtitle">Transport &amp; Distribution</div>
            </div>
          </div>
          <span className="sidebar-location-badge">Bunia · Ituri</span>
        </div>

        <nav className="sidebar-nav">
          {visibleGroups.map((group) => (
            <div key={group.title} className="nav-group" style={accentStyle(group.color)}>
              <div className="nav-group-title">{group.title}</div>
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
          ))}
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
