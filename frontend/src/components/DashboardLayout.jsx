import React from 'react';
import { motion } from 'framer-motion';
import { PlusCircle, History, MessageSquare, LogOut, Bot } from 'lucide-react';

const DashboardLayout = ({ children, activeTab = 'new', onTabChange, onLogout }) => {
  
  const navItems = [
    { id: 'new', label: 'New Interview', icon: PlusCircle },
    { id: 'history', label: 'Interview History', icon: History },
    { id: 'coach', label: 'Coach Chat', icon: MessageSquare }
  ];

  return (
    <div className="flex justify-center items-center min-h-screen bg-background text-foreground p-4 sm:p-8">
      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex w-full max-w-[1400px] h-full min-h-[85vh] bg-card rounded-2xl shadow-floating overflow-hidden border border-border"
      >
        {/* Sidebar */}
        <div className="w-[280px] flex flex-col p-8 bg-secondary/30 border-r border-border">
          <div className="flex items-center gap-3 mb-10">
            <div className="p-2 bg-primary/10 rounded-xl">
              <Bot size={28} className="text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground font-heading tracking-tight">Caliber</h1>
          </div>

          <nav className="flex-1 flex flex-col gap-2">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange && onTabChange(item.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 font-medium ${
                    isActive 
                      ? 'bg-primary text-primary-foreground shadow-sm' 
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <item.icon size={20} className={isActive ? 'text-primary-foreground' : ''} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <button
            onClick={onLogout}
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive mt-auto"
          >
            <LogOut size={20} />
            Logout
          </button>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 relative bg-card">
          <div className="absolute inset-0 z-10 w-full h-full overflow-y-auto">
            {children}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default DashboardLayout;
