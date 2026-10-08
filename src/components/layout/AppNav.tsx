import { Link } from "@tanstack/react-router";
import { Camera, UserPlus, ClipboardList, CalendarClock, Users, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/shared";

export function AppNav() {
  const desktopLinkCls =
    "inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150";
  const desktopActiveCls = "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground shadow-xs";

  const mobileLinkCls =
    "flex flex-col items-center justify-center py-2 px-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors";
  const mobileActiveCls = "text-primary font-semibold";

  return (
    <>
      {/* Accessibility: Skip Navigation Link for Screen Readers & Keyboard Users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-3 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg focus:top-2 focus:left-2"
      >
        Skip to main content
      </a>

      {/* Main Top Header Navigation */}
      <header className="border-b border-border/80 bg-card/80 backdrop-blur-md sticky top-0 z-40 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-15 flex items-center justify-between">

          {/* Brand & Institution Badge */}
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2.5 font-bold tracking-tight text-foreground hover:opacity-95 transition-opacity">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/20">
                <Camera className="h-5 w-5" />
              </span>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-bold tracking-tight text-foreground">FaceMark</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent/20 text-accent-foreground border border-accent/30 tracking-wider uppercase">
                    PRO
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground font-normal hidden sm:inline">
                  Smart Academic Attendance
                </span>
              </div>
            </Link>

            {/* System Status Pill */}
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/10 border border-success/20 text-success text-xs font-medium">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Biometric Node Ready</span>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-1.5" aria-label="Main Navigation">
            <Link
              to="/"
              className={desktopLinkCls}
              activeProps={{ className: `${desktopLinkCls} ${desktopActiveCls}` }}
              activeOptions={{ exact: true }}
            >
              <Camera className="h-4 w-4" /> Attendance
            </Link>
            <Link
              to="/classes"
              className={desktopLinkCls}
              activeProps={{ className: `${desktopLinkCls} ${desktopActiveCls}` }}
            >
              <CalendarClock className="h-4 w-4" /> Classes
            </Link>
            <Link
              to="/people"
              className={desktopLinkCls}
              activeProps={{ className: `${desktopLinkCls} ${desktopActiveCls}` }}
            >
              <Users className="h-4 w-4" /> People
            </Link>
            <Link
              to="/enroll"
              className={desktopLinkCls}
              activeProps={{ className: `${desktopLinkCls} ${desktopActiveCls}` }}
            >
              <UserPlus className="h-4 w-4" /> Enroll
            </Link>
            <Link
              to="/logs"
              className={desktopLinkCls}
              activeProps={{ className: `${desktopLinkCls} ${desktopActiveCls}` }}
            >
              <ClipboardList className="h-4 w-4" /> Analytics & Logs
            </Link>
            <div className="h-5 w-[1px] bg-border mx-1" />
            <ThemeToggle />
          </nav>

          {/* Mobile Right Controls */}
          <div className="flex md:hidden items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar (< 768px) */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border px-2 py-1 flex items-center justify-around shadow-lg safe-area-bottom"
        aria-label="Mobile Navigation"
      >
        <Link
          to="/"
          className={mobileLinkCls}
          activeProps={{ className: `${mobileLinkCls} ${mobileActiveCls}` }}
          activeOptions={{ exact: true }}
        >
          <Camera className="h-5 w-5 mb-0.5" />
          <span>Attendance</span>
        </Link>
        <Link
          to="/classes"
          className={mobileLinkCls}
          activeProps={{ className: `${mobileLinkCls} ${mobileActiveCls}` }}
        >
          <CalendarClock className="h-5 w-5 mb-0.5" />
          <span>Classes</span>
        </Link>
        <Link
          to="/people"
          className={mobileLinkCls}
          activeProps={{ className: `${mobileLinkCls} ${mobileActiveCls}` }}
        >
          <Users className="h-5 w-5 mb-0.5" />
          <span>People</span>
        </Link>
        <Link
          to="/enroll"
          className={mobileLinkCls}
          activeProps={{ className: `${mobileLinkCls} ${mobileActiveCls}` }}
        >
          <UserPlus className="h-5 w-5 mb-0.5" />
          <span>Enroll</span>
        </Link>
        <Link
          to="/logs"
          className={mobileLinkCls}
          activeProps={{ className: `${mobileLinkCls} ${mobileActiveCls}` }}
        >
          <ClipboardList className="h-5 w-5 mb-0.5" />
          <span>Logs</span>
        </Link>
      </nav>
    </>
  );
}
