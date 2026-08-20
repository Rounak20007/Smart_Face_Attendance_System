import { Link } from "@tanstack/react-router";
import { Camera, UserPlus, ClipboardList, CalendarClock, Users } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";


export function AppNav() {
  const linkCls =
    "inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";
  const activeCls = "bg-accent text-foreground";
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Camera className="h-4 w-4" />
          </span>
          FaceMark
        </Link>
        <nav className="flex items-center gap-1">
          <Link to="/" className={linkCls} activeProps={{ className: `${linkCls} ${activeCls}` }} activeOptions={{ exact: true }}>
            <Camera className="h-4 w-4" /> Attendance
          </Link>
          <Link to="/enroll" className={linkCls} activeProps={{ className: `${linkCls} ${activeCls}` }}>
            <UserPlus className="h-4 w-4" /> Enroll
          </Link>
          <Link to="/people" className={linkCls} activeProps={{ className: `${linkCls} ${activeCls}` }}>
            <Users className="h-4 w-4" /> People
          </Link>
          <Link to="/classes" className={linkCls} activeProps={{ className: `${linkCls} ${activeCls}` }}>
            <CalendarClock className="h-4 w-4" /> Classes
          </Link>
          <Link to="/logs" className={linkCls} activeProps={{ className: `${linkCls} ${activeCls}` }}>

            <ClipboardList className="h-4 w-4" /> Logs
          </Link>
          <ThemeToggle />
        </nav>



      </div>
    </header>
  );
}