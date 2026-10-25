import React from 'react';
import * as LucideIcons from 'lucide-react';

interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

const iconComponents = LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>;

const Icon: React.FC<IconProps> = ({ name, size = 20, className }) => {
  const IconComponent = iconComponents[name] || LucideIcons.Link;
  return <IconComponent size={size} className={className} />;
};

export default Icon;