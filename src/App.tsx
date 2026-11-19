import { useCallback, useEffect, useRef, useState } from 'react';
import { BattleHud } from './components/BattleHud';
import { PauseVictoryModal } from './components/PauseVictoryModal';
import { SetupModal } from './components/SetupModal';
import { TitleOverlay } from './components/TitleOverlay';
import { tacticalAudio } from './game/audio';
import { BattleEngine, type MinimapDrawData } from './game/battleScene';
import { ARMY_BUDGET, DEFAULT_ARMY_ROSTER, UNIT_CLASSES } from './game/constants';
import { calculateRosterCost } from './game/rules';
import type { ArmyRosterEntry, BattleSnapshot, DifficultyLevel, GamePhase, UnitClass } from './game/types';

const INITIAL_SNAPSHOT: BattleSnapshot = {
  phase: 'title',
  outcome: null,
  elapsedSeconds: 0,
  exploredPercent: 0,
  alliedSquadsAlive: 0,
  alliedSquadsTotal: 0,
  enemySquadsAlive: 0,
  enemySquadsTotal: 0,
  alliedSoldiersAlive: 0,
  enemySoldiersAlive: 0,
  medalsAwardedCount: 0,
  selectedSquad: null,
  alliedSquads: [],
  visibleEnemySquads: [],
  commandFeedback: null,
  recentNotifications: [],
  difficulty: 'medium',
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<BattleEngine | null>(null);

  const [roster, setRoster] = useState<ArmyRosterEntry[]>(DEFAULT_ARMY_ROSTER);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');
  const [phase, setPhase] = useState<GamePhase>('title');
  const [muted, setMuted] = useState(false);
  const [snapshot, setSnapshot] = useState<BattleSnapshot>(INITIAL_SNAPSHOT);

  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;

  // Sync game state to document.body.dataset.state
  useEffect(() => {
    document.body.dataset.state = phase;
  }, [phase]);

  // Mount WebGL engine once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const params = new URLSearchParams(window.location.search);
    const autoStart = params.get('autostart') === '1';

    const engine = new BattleEngine(
      container,
      (snap) => {
        setSnapshot(snap);
        setPhase(snap.phase);
      },
      rosterRef.current,
      difficultyRef.current,
    );
    engineRef.current = engine;

    if (autoStart) {
      engine.resetSimulation(rosterRef.current, difficultyRef.current, 'playing');
    }

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleStartBattle = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    engineRef.current?.resetSimulation(rosterRef.current, difficultyRef.current, 'playing');
  }, []);

  const handleOpenSetup = useCallback(() => {
    setPhase('setup');
    engineRef.current?.setPhase('setup');
  }, []);

  const handleBackToTitle = useCallback(() => {
    engineRef.current?.resetSimulation(rosterRef.current, difficultyRef.current, 'title');
  }, []);

  const handleTogglePause = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.phase === 'playing') {
      eng.setPhase('paused');
    } else if (eng.phase === 'paused') {
      eng.setPhase('playing');
    }
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      tacticalAudio.setMuted(next);
      return next;
    });
  }, []);

  // Global keyboard shortcuts (Enter/Space on title, Esc/P pause, M mute, R restart)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

      if (phase === 'title' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        handleStartBattle();
        return;
      }

      if (e.key === 'Escape' || e.key.toLowerCase() === 'p') {
        if (phase === 'playing' || phase === 'paused') {
          e.preventDefault();
          handleTogglePause();
        }
        return;
      }

      if (e.key.toLowerCase() === 'm' && phase === 'playing') {
        handleToggleMute();
      } else if (e.key.toLowerCase() === 'r' && phase === 'playing') {
        handleStartBattle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, handleStartBattle, handleTogglePause, handleToggleMute]);

  const handleAddSquad = useCallback((unitClass: UnitClass) => {
    setRoster((prev) => {
      const spent = calculateRosterCost(prev);
      if (spent + UNIT_CLASSES[unitClass].cost > ARMY_BUDGET) return prev;
      return [...prev, { id: `sq-${Date.now()}-${Math.random()}`, unitClass }];
    });
  }, []);

  const handleRemoveSquad = useCallback((id: string) => {
    setRoster((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleResetPreset = useCallback(() => {
    setRoster(DEFAULT_ARMY_ROSTER);
  }, []);

  const getMinimapData = useCallback((): MinimapDrawData => {
    if (!engineRef.current) {
      return { fogGrid: new Uint8Array(0), gridRes: 1, squads: [], cameraX: 0, cameraZ: 0 };
    }
    return engineRef.current.getMinimapData();
  }, []);

  const armyCost = calculateRosterCost(roster);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0b1017]">
      {/* Isolated WebGL Canvas Container */}
      <div
        ref={mountRef}
        data-testid="battlefield-canvas-container"
        className="absolute inset-0 w-full h-full"
      />

      {phase === 'title' && (
        <TitleOverlay
          armyCount={roster.length}
          armyCost={armyCost}
          difficulty={difficulty}
          onStartBattle={handleStartBattle}
          onOpenSetup={handleOpenSetup}
        />
      )}

      {phase === 'setup' && (
        <SetupModal
          roster={roster}
          difficulty={difficulty}
          onChangeDifficulty={setDifficulty}
          onAddSquad={handleAddSquad}
          onRemoveSquad={handleRemoveSquad}
          onResetPreset={handleResetPreset}
          onBack={handleBackToTitle}
          onDeploy={handleStartBattle}
        />
      )}

      {phase === 'playing' && (
        <BattleHud
          snapshot={snapshot}
          muted={muted}
          getMinimapData={getMinimapData}
          onSelectSquad={(id) => engineRef.current?.selectSquadById(id)}
          onPanToWorld={(x, z) => engineRef.current?.panToWorld(x, z)}
          onSubmitCommand={(cmd) => engineRef.current?.issueTextCommand(cmd)}
          onToggleMute={handleToggleMute}
          onPause={handleTogglePause}
          onRestart={handleStartBattle}
        />
      )}

      {(phase === 'paused' || phase === 'gameover') && (
        <PauseVictoryModal
          snapshot={snapshot}
          onResume={handleTogglePause}
          onPlayAgain={handleStartBattle}
          onOpenSetup={handleOpenSetup}
          onReturnTitle={handleBackToTitle}
        />
      )}
    </main>
  );
}
