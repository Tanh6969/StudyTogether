import { Outlet } from 'react-router-dom';
import { Header } from './Header';

export function Layout() {
  return (
    <div>
      <Header />
      {/* Phones: leave room for the floating bottom bar (60px + 12px gap + safe area + 12px)
          so it never covers the end of the page. */}
      <div className="pb-[calc(84px+env(safe-area-inset-bottom))] sm:pb-0">
        <Outlet />
      </div>
    </div>
  );
}
