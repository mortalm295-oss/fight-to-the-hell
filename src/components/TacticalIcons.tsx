import React from 'react';
import type { MedalId, UnitClass } from '../game/types';

export const TitleCrestSvg: React.FC<{ className?: string }> = ({ className = 'w-14 h-14' }) => (
  <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="crestGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f2d588" />
        <stop offset="100%" stopColor="#a67c32" />
      </linearGradient>
    </defs>
    {/* Outer shield silhouette */}
    <path
      d="M32 4 L54 13 V31 C54 45 43 55 32 60 C21 55 10 45 10 31 V13 Z"
      fill="#101824"
      stroke="url(#crestGold)"
      strokeWidth="2.5"
    />
    {/* Mandelbulb-inspired octagonal sacred geometry prism inside shield */}
    <polygon
      points="32,14 43,21 47,33 39,44 25,44 17,33 21,21"
      fill="none"
      stroke="#4ba3c3"
      strokeWidth="1.6"
      opacity="0.85"
    />
    {/* Crossed spears & central diamond crest */}
    <path d="M21 45 L43 19 M43 45 L21 19" stroke="#d4a84f" strokeWidth="2.2" strokeLinecap="round" />
    <polygon points="32,20 38,31 32,42 26,31" fill="url(#crestGold)" stroke="#0d141f" strokeWidth="1.5" />
  </svg>
);

export const UnitClassIcon: React.FC<{ unitClass: UnitClass; className?: string }> = ({
  unitClass,
  className = 'w-6 h-6',
}) => {
  switch (unitClass) {
    case 'heavy_infantry':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            d="M5 4h14v9c0 4.5-7 8-7 8s-7-3.5-7-8V4z"
            fill="#2c4e78"
            stroke="#e8e3d8"
            strokeWidth="1.6"
          />
          <circle cx="12" cy="11" r="2.4" fill="#d4a84f" stroke="#101824" strokeWidth="1" />
          <path d="M12 4v4.5M12 13.5V20" stroke="#9ab8db" strokeWidth="1.2" />
        </svg>
      );
    case 'light_infantry':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path d="M5 19L17 7l2-3-3 2L4 18l1 1z" fill="#cad4e0" stroke="#101824" strokeWidth="1.2" />
          <circle cx="9" cy="15" r="4" fill="#b88d42" stroke="#e8e3d8" strokeWidth="1.4" />
          <circle cx="9" cy="15" r="1.3" fill="#101824" />
        </svg>
      );
    case 'heavy_archers':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path d="M7 3c6 3 6 15 0 18" fill="none" stroke="#d4a84f" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="7" y1="3" x2="7" y2="21" stroke="#cbd5e1" strokeWidth="1.1" />
          <path d="M4 12h15l-3-2.5M19 12l-3 2.5" fill="none" stroke="#e8e3d8" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'light_archers':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path d="M9 5c4.5 2.5 4.5 11.5 0 14" fill="none" stroke="#6ec29b" strokeWidth="2" strokeLinecap="round" />
          <line x1="9" y1="5" x2="9" y2="19" stroke="#cbd5e1" strokeWidth="1" />
          <path d="M5 12h14l-2.5-2M19 12l-2.5 2" fill="none" stroke="#e8e3d8" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'heavy_cavalry':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            d="M5 18l2-6 4-5 4-2 2 2-2 3 3 2-2 3-3 1-1 3H5z"
            fill="#b8c4d0"
            stroke="#101824"
            strokeWidth="1.2"
          />
          <path d="M3 19L21 4" stroke="#d4a84f" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'light_cavalry':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            d="M6 19c1-4 4-8 8-11l4-2-1 4c-2 2-4 5-4 9H6z"
            fill="#c9854c"
            stroke="#e8e3d8"
            strokeWidth="1.3"
          />
          <path d="M13 6l5-2-2 5" fill="none" stroke="#e8e3d8" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case 'scouts':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="7.5" fill="none" stroke="#48b8a0" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="2.5" fill="#e8e3d8" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="#48b8a0" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
};

export const MedalIcon: React.FC<{ medalId: MedalId; color: string; className?: string }> = ({
  medalId,
  color,
  className = 'w-5 h-5',
}) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path d="M8 2h8l-2 6h-4L8 2z" fill="#2c3e55" stroke="#e8e3d8" strokeWidth="1.1" />
    <circle cx="12" cy="14" r="7" fill={color} stroke="#0e141e" strokeWidth="1.6" />
    {medalId === 'first_blood' && (
      <path d="M12 9.5l1.5 3.2L17 13l-2.5 2.2.7 3.3L12 16.8 8.8 18.5l.7-3.3L7 13l3.5-.3z" fill="#fff5e6" />
    )}
    {medalId === 'high_ground_master' && (
      <path d="M7.5 17l4.5-6.5L16.5 17H7.5z" fill="#101824" stroke="#fff5e6" strokeWidth="1" />
    )}
    {medalId === 'map_explorer' && (
      <path d="M12 9l2 5-2 5-2-5 2-5z" fill="#101824" stroke="#fff5e6" strokeWidth="1" />
    )}
    {medalId === 'flanking_victory' && (
      <path d="M8 14h6l-2-2.5M14 14l-2 2.5" fill="none" stroke="#101824" strokeWidth="1.8" strokeLinecap="round" />
    )}
    {medalId === 'shield_bastion' && (
      <path d="M9 11h6v3c0 2-3 3.5-3 3.5S9 16 9 14v-3z" fill="#101824" stroke="#fff5e6" strokeWidth="1" />
    )}
    {medalId === 'thunder_charge' && (
      <path d="M13 9l-3 5h3l-1 4 4-5h-3l0-4z" fill="#101824" stroke="#fff5e6" strokeWidth="0.9" />
    )}
  </svg>
);
