import React from 'react';
import {
  ARMY_BUDGET,
  DEFAULT_ARMY_ROSTER,
  DIFFICULTY_CONFIG,
  UNIT_CLASSES,
  UNIT_CLASS_LIST,
} from '../game/constants';
import { calculateRosterCost } from '../game/rules';
import type { ArmyRosterEntry, DifficultyLevel, UnitClass } from '../game/types';
import { UnitClassIcon } from './TacticalIcons';

interface SetupModalProps {
  roster: ArmyRosterEntry[];
  difficulty: DifficultyLevel;
  onChangeDifficulty: (d: DifficultyLevel) => void;
  onAddSquad: (u: UnitClass) => void;
  onRemoveSquad: (id: string) => void;
  onResetPreset: () => void;
  onBack: () => void;
  onDeploy: () => void;
}

export const SetupModal: React.FC<SetupModalProps> = ({
  roster,
  difficulty,
  onChangeDifficulty,
  onAddSquad,
  onRemoveSquad,
  onResetPreset,
  onBack,
  onDeploy,
}) => {
  const spent = calculateRosterCost(roster);
  const remaining = ARMY_BUDGET - spent;
  const canDeploy = roster.length > 0 && spent <= ARMY_BUDGET;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 md:p-8 bg-[#070b11]/82">
      <div
        role="dialog"
        aria-label="Pre-Game Army Setup"
        className="w-full max-w-5xl max-h-[90vh] flex flex-col bg-[#0e1622] border border-[#c4a25c]/35 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-white/10 bg-[#0b111b]">
          <div>
            <h2 className="font-display text-xl md:text-2xl font-bold text-[#f3ede0]">
              Army & Battle Configuration
            </h2>
            <p className="text-xs text-[#9fb0c4] mt-0.5">
              Select AI difficulty and assemble your battalions within the {ARMY_BUDGET}-point command budget.
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-[#9fb0c4]">Budget Remaining</div>
              <div
                className={`font-mono-num text-xl font-semibold ${
                  remaining < 0 ? 'text-[#e0534e]' : 'text-[#c4a25c]'
                }`}
              >
                {remaining} / {ARMY_BUDGET} pts
              </div>
            </div>
            <button
              type="button"
              onClick={onBack}
              className="px-4 py-2 text-xs font-medium text-[#cbd5e1] hover:text-white border border-white/15 hover:bg-white/5 cursor-pointer whitespace-nowrap shrink-0"
            >
              Back
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-y-auto tactical-scroll">
          {/* Left: Difficulty + Unit Catalog */}
          <div className="lg:col-span-7 p-6 border-b lg:border-b-0 lg:border-r border-white/10 space-y-6">
            {/* AI Difficulty */}
            <div>
              <h3 className="text-xs uppercase tracking-wider text-[#9fb0c4] font-semibold mb-2.5">
                AI Commander Difficulty
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {(['easy', 'medium', 'hard', 'tactician'] as DifficultyLevel[]).map((lvl) => {
                  const cfg = DIFFICULTY_CONFIG[lvl];
                  const active = difficulty === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => onChangeDifficulty(lvl)}
                      aria-pressed={active}
                      className={`p-3 text-left border transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#1c2a3e] border-[#c4a25c] text-[#f3ede0]'
                          : 'bg-[#0b111b] border-white/10 text-[#9fb0c4] hover:border-white/25'
                      }`}
                    >
                      <div className="text-sm font-semibold">{cfg.label}</div>
                      <div className="text-[11px] text-[#9fb0c4] mt-1 leading-snug">
                        {cfg.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Unit Recruitment Grid */}
            <div>
              <h3 className="text-xs uppercase tracking-wider text-[#9fb0c4] font-semibold mb-2.5">
                Available Unit Classes
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {UNIT_CLASS_LIST.map((unit) => {
                  const affordable = remaining >= unit.cost;
                  return (
                    <div
                      key={unit.id}
                      className="flex flex-col justify-between p-3.5 bg-[#0b111b] border border-white/10"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <UnitClassIcon unitClass={unit.id} className="w-6 h-6 shrink-0" />
                            <span className="text-sm font-semibold text-[#f3ede0]">
                              {unit.name}
                            </span>
                          </div>
                          <span className="font-mono-num text-xs font-semibold text-[#c4a25c]">
                            {unit.cost} pts
                          </span>
                        </div>
                        <p className="text-xs text-[#9fb0c4] mt-2 leading-snug">
                          {unit.roleSummary}
                        </p>
                        <div className="flex items-center gap-2 text-[11px] font-mono-num text-[#8396ab] mt-2">
                          <span>{unit.squadSize} Troops</span>
                          <span aria-hidden="true">·</span>
                          <span>ATK {unit.attack}</span>
                          <span aria-hidden="true">·</span>
                          <span>LoS {unit.visionRadius}m</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!affordable}
                        onClick={() => onAddSquad(unit.id)}
                        className={`mt-3 w-full py-1.5 px-3 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                          affordable
                            ? 'bg-[#1a293d] hover:bg-[#243954] text-[#e8e3d8] border border-[#c4a25c]/35 cursor-pointer'
                            : 'bg-[#101620] text-[#5c6b7c] border border-white/5 cursor-not-allowed'
                        }`}
                      >
                        {affordable ? `Recruit ${unit.name}` : 'Insufficient Budget'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Active Army Roster */}
          <div className="lg:col-span-5 p-6 flex flex-col justify-between bg-[#0b111b]/60">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs uppercase tracking-wider text-[#9fb0c4] font-semibold">
                  Your Battalions ({roster.length})
                </h3>
                <button
                  type="button"
                  onClick={onResetPreset}
                  className="text-xs text-[#c4a25c] hover:underline cursor-pointer"
                >
                  Restore Default ({DEFAULT_ARMY_ROSTER.length})
                </button>
              </div>

              {roster.length === 0 ? (
                <div className="p-6 border border-dashed border-white/15 text-center text-xs text-[#8396ab]">
                  No squads recruited yet. Add at least 1 squad from the left catalog to deploy.
                </div>
              ) : (
                <ul className="space-y-2 max-h-[400px] overflow-y-auto tactical-scroll pr-1">
                  {roster.map((entry, idx) => {
                    const def = UNIT_CLASSES[entry.unitClass];
                    return (
                      <li
                        key={entry.id}
                        className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-[#111a28] border border-white/10"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono-num text-xs text-[#8396ab] w-4">
                            {idx + 1}.
                          </span>
                          <UnitClassIcon unitClass={entry.unitClass} className="w-5 h-5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[#f3ede0] truncate">
                              {def.name}
                            </div>
                            <div className="text-[11px] font-mono-num text-[#9fb0c4]">
                              {def.squadSize} troops · {def.cost} pts
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemoveSquad(entry.id)}
                          aria-label={`Remove ${def.name} ${idx + 1}`}
                          className="px-2.5 py-1 text-xs text-[#e26d5c] hover:bg-[#e26d5c]/10 border border-[#e26d5c]/30 cursor-pointer shrink-0"
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="pt-5 mt-5 border-t border-white/10 flex items-center justify-between gap-4">
              <div className="text-xs text-[#9fb0c4] font-mono-num">
                Spent: <strong className="text-[#f3ede0]">{spent}</strong> pts
              </div>
              <button
                type="button"
                disabled={!canDeploy}
                onClick={onDeploy}
                className={`px-6 py-3 text-sm font-semibold tracking-wide transition-colors whitespace-nowrap shrink-0 ${
                  canDeploy
                    ? 'bg-[#c4a25c] hover:bg-[#d8b770] text-[#0c111a] cursor-pointer'
                    : 'bg-[#1a222d] text-[#5c6b7c] cursor-not-allowed'
                }`}
              >
                Deploy Army
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
