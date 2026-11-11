import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  Download,
  Droplets,
  Github,
  Maximize,
  Minimize,
  MonitorCog,
  Moon,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Scale,
  Sun,
  Timer,
  Trash2,
  Upload,
  Utensils,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Recipe, RecipeStep, StepAction } from './types';
import { ACTION_LABELS, formatTime, getStepFlowRate, getStepSchedule, totalDuration, totalWater } from './recipe';
import { useBrewTimer } from './useBrewTimer';
import RecipeEditor from './RecipeEditor';
import DriveLibrary from './DriveLibrary';
import DriveConnectionStatus from './DriveConnectionStatus';
import DriveSaveStatus from './DriveSaveStatus';
import { mergeBackup } from './driveBackup';
import { downloadRecipe, loadLibrary, readRecipeFile, saveLibrary } from './storage';
import type { Library } from './storage';
import { useDriveSync } from './useDriveSync';
import { useAppUpdate } from './useAppUpdate';
import { useBrewFullscreen } from './useBrewFullscreen';
import { useTheme } from './theme';
import type { ThemeMode } from './theme';

const ACTION_ICONS: Record<StepAction, LucideIcon> = {
  pour: Droplets,
  wait: Timer,
  swirl: Waves,
  stir: Utensils,
};

const SOUND_KEY = 'pour-guide.sound.v1';

const THEME_LABELS: Record<ThemeMode, string> = {
  auto: '자동',
  light: '라이트',
  dark: '다크',
};

const THEME_NEXT: Record<ThemeMode, ThemeMode> = {
  auto: 'light',
  light: 'dark',
  dark: 'auto',
};

function loadSoundPreference(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

function blankRecipe(): Recipe {
  return {
    id: crypto.randomUUID(),
    name: '새 레시피',
    description: '나만의 추출 흐름을 기록해 보세요.',
    coffee: 15,
    temperature: 92,
    grind: '중간',
    dripper: 'V60',
    steps: [
      { id: crypto.randomUUID(), title: '블룸', action: 'pour', duration: 30, water: 30, flowRate: null, note: '원두 전체를 적시며 천천히 부어 주세요.' },
      { id: crypto.randomUUID(), title: '블룸 대기', action: 'wait', duration: 30, water: 0, flowRate: null, note: '가스가 빠져나가도록 기다립니다.' },
      { id: crypto.randomUUID(), title: '본 추출', action: 'pour', duration: 60, water: 180, flowRate: null, note: '중심에서 바깥으로 나선을 그리세요.' },
      { id: crypto.randomUUID(), title: '마무리', action: 'wait', duration: 45, water: 0, flowRate: null, note: '드립이 끝날 때까지 기다립니다.' },
    ],
  };
}

function instructionFor(step: RecipeStep): string {
  switch (step.action) {
    case 'pour':
      return `${step.duration}초 동안 물 ${step.water}g을 ${getStepFlowRate(step).toFixed(2)}g/s로 부으세요.`;
    case 'wait':
      return `${step.duration}초 동안 기다리세요. 드리퍼 안의 물이 천천히 빠져나가도록 두면 됩니다.`;
    case 'swirl':
      return `${step.duration}초 동안 드리퍼를 부드럽게 스월링하세요. 원두 베드가 고르게 섞이면 충분합니다.`;
    case 'stir':
      return `${step.duration}초 동안 스푼으로 한 방향으로 천천히 스티어링하세요.`;
  }
}

function ActionIcon({ action, size = 18 }: { action: StepAction; size?: number }) {
  const Icon = ACTION_ICONS[action];
  return <Icon size={size} strokeWidth={1.9} aria-hidden="true" />;
}

function App() {
  const [library, setLibrary] = useState<Library>(loadLibrary);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [sound, setSound] = useState(loadSoundPreference);
  const [flash, setFlash] = useState('');
  const [sidebarNotice, setSidebarNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const theme = useTheme();
  const libraryToggle = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = library.recipes.find(recipe => recipe.id === library.activeId) ?? library.recipes[0];
  const brew = useBrewTimer(active, sound);
  const schedule = getStepSchedule(active);
  const step = active.steps[brew.snapshot.stepIndex] ?? active.steps[0];
  const next = schedule[brew.snapshot.stepIndex + 1];
  const stepDuration = Math.max(1, step.duration);
  const stepProgress = Math.min(1, brew.snapshot.stepElapsed / stepDuration);
  const waterTotal = totalWater(active);
  const duration = totalDuration(active);
  const ratio = `${(waterTotal / active.coffee).toFixed(1)}`;
  const isRunning = brew.status === 'running';
  const isPaused = brew.status === 'paused';
  const isComplete = brew.status === 'completed';
  const isIdle = brew.status === 'idle';
  const stepFlowRate = getStepFlowRate(step);
  const finalStepTarget = isComplete
    ? waterTotal
    : isIdle
      ? (schedule[0]?.waterAfter ?? 0)
      : brew.snapshot.waterAfter;
  const liveTarget = isComplete ? waterTotal : brew.snapshot.targetWater;
  const pouredThisStep = Math.max(0, liveTarget - brew.snapshot.waterBefore);
  const reachedTarget = step.action === 'pour' && !isComplete && liveTarget >= finalStepTarget;
  const fullscreen = useBrewFullscreen();
  const updateRefreshBlocked = isRunning || isPaused || editing !== null || fullscreen.active || driveBusy;
  // The completed screen may offer the update, but it must not disappear on its
  // own while the user is reading the result.
  const driveSync = useDriveSync(library, setLibrary, updateRefreshBlocked || isComplete);
  const update = useAppUpdate(updateRefreshBlocked || driveSync.busy || isComplete, updateRefreshBlocked || driveSync.busy);

  useEffect(() => {
    if (!saveLibrary(library)) {
      setSidebarNotice('브라우저 저장 공간을 사용할 수 없어 변경 사항이 유지되지 않습니다.');
    }
  }, [library]);

  useEffect(() => {
    try {
      localStorage.setItem(SOUND_KEY, sound ? 'on' : 'off');
    } catch {
      // Preference persistence is optional.
    }
  }, [sound]);

  useEffect(() => {
    if (!flash) return;
    const timeout = window.setTimeout(() => setFlash(''), 3800);
    return () => window.clearTimeout(timeout);
  }, [flash]);

  useEffect(() => {
    if (!editing) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [editing]);

  useEffect(() => {
    if (!libraryOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setLibraryOpen(false);
      libraryToggle.current?.focus();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [libraryOpen]);

  useEffect(() => {
    if (!pendingDelete) return;
    const timeout = window.setTimeout(() => setPendingDelete(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [pendingDelete]);

  const selectRecipe = (id: string) => {
    setLibraryOpen(false);
    if (window.matchMedia('(max-width: 800px)').matches) libraryToggle.current?.focus();
    if (id === library.activeId) return;
    setPendingDelete(null);
    setSidebarNotice('');
    setLibrary(previous => ({ ...previous, activeId: id }));
    brew.reset();
  };

  const saveEditedRecipe = (recipe: Recipe) => {
    setLibrary(previous => {
      const exists = previous.recipes.some(item => item.id === recipe.id);
      return {
        recipes: exists
          ? previous.recipes.map(item => (item.id === recipe.id ? recipe : item))
          : [...previous.recipes, recipe],
        activeId: recipe.id,
      };
    });
    setEditing(null);
    setSidebarNotice('');
    brew.reset();
    setFlash('레시피를 저장했습니다.');
  };

  const deleteRecipe = (id: string) => {
    if (library.recipes.length <= 1) return;
    const recipes = library.recipes.filter(recipe => recipe.id !== id);
    const activeId = library.activeId === id ? recipes[0].id : library.activeId;
    setLibrary({ recipes, activeId });
    setPendingDelete(null);
    if (library.activeId === id) brew.reset();
    setFlash('레시피를 삭제했습니다.');
  };

  const importRecipe = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = await readRecipeFile(file);
      const recipe = library.recipes.some(item => item.id === imported.id)
        ? { ...imported, id: crypto.randomUUID() }
        : imported;
      setLibrary(previous => ({ recipes: [...previous.recipes, recipe], activeId: recipe.id }));
      setSidebarNotice('');
      setPendingDelete(null);
      brew.reset();
      setFlash(`‘${recipe.name}’ 레시피를 가져왔습니다.`);
    } catch (error) {
      setSidebarNotice(error instanceof Error ? error.message : '레시피 파일을 읽지 못했습니다.');
    } finally {
      event.target.value = '';
    }
  };

  const start = () => {
    setSidebarNotice('');
    brew.start();
  };

  return (
    <div className="app">
      <a className="skip-link" href="#brew" inert={fullscreen.active}>추출 안내로 건너뛰기</a>
      <header className="topbar" inert={fullscreen.active}>
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Pour Guide 홈">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40" width="30" height="30" fill="none">
              <path d="M8 13.5h24L22.5 29h-5L8 13.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M14 8h12M15 33h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span>
            <strong>Pour Guide</strong>
            <small>한 잔에 집중하는 시간</small>
          </span>
        </a>
        <div className="topbar-actions">
          <button
            className="icon-button theme-toggle"
            type="button"
            aria-label={`화면 테마: ${THEME_LABELS[theme.mode]}. 누르면 ${THEME_LABELS[THEME_NEXT[theme.mode]]} 모드로 바뀝니다.`}
            title={`화면 테마: ${THEME_LABELS[theme.mode]} → ${THEME_LABELS[THEME_NEXT[theme.mode]]}`}
            onClick={theme.cycle}
          >
            {theme.mode === 'auto' ? <MonitorCog size={19} /> : theme.mode === 'light' ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button
            className="icon-button"
            type="button"
            aria-pressed={sound}
            aria-label={sound ? '소리 알림 끄기' : '소리 알림 켜기'}
            title={sound ? '소리 알림 끄기' : '소리 알림 켜기'}
            onClick={() => {
              if (!sound) void brew.previewSound();
              setSound(value => !value);
            }}
          >
            {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <a
            className="icon-button"
            href="https://github.com/licht0182/pour-guide"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub 저장소 열기"
            title="GitHub 저장소"
          >
            <Github size={19} />
          </a>
        </div>
      </header>

      <main className="workspace">
        <h1 className="sr-only">Pour Guide 추출 가이드</h1>
        <button
          ref={libraryToggle}
          className="library-toggle"
          type="button"
          aria-expanded={libraryOpen}
          aria-controls="recipe-library"
          inert={fullscreen.active}
          onClick={() => setLibraryOpen(open => !open)}
        >
          <BookOpen size={20} aria-hidden="true" />
          <span>레시피 선택 <strong>{active.name}</strong></span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
        <aside id="recipe-library" className={`library${libraryOpen ? ' is-open' : ''}`} aria-label="레시피 보관함" inert={fullscreen.active}>
          <div className="library-heading">
            <p className="eyebrow">나의 컬렉션</p>
            <h2>레시피</h2>
            <p>오늘 내릴 한 잔을 골라보세요.</p>
          </div>

          <div className="library-list">
            {library.recipes.map(recipe => {
              const selected = recipe.id === active.id;
              return (
                <div className={`recipe-item${selected ? ' is-active' : ''}`} key={recipe.id}>
                  <button
                    className="recipe-select"
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => selectRecipe(recipe.id)}
                  >
                    <span className="recipe-select-name">{recipe.name}</span>
                    <span className="recipe-select-meta">
                      {recipe.coffee}g · {totalWater(recipe)}g · {formatTime(totalDuration(recipe))}
                    </span>
                    <span className="recipe-select-meta">
                      {recipe.dripper} · {recipe.grind}
                    </span>
                  </button>
                  {library.recipes.length > 1 && (
                    <button
                      className={`recipe-delete${pendingDelete === recipe.id ? ' is-armed' : ''}`}
                      type="button"
                      title={pendingDelete === recipe.id ? '한 번 더 누르면 삭제합니다' : '레시피 삭제'}
                      aria-label={
                        pendingDelete === recipe.id
                          ? `${recipe.name} 레시피를 정말 삭제합니다`
                          : `${recipe.name} 레시피 삭제`
                      }
                      onClick={() => {
                        if (pendingDelete === recipe.id) deleteRecipe(recipe.id);
                        else setPendingDelete(recipe.id);
                      }}
                    >
                      {pendingDelete === recipe.id ? <span>확인</span> : <Trash2 size={15} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="library-actions">
            <button className="btn btn-secondary" type="button" onClick={() => setEditing(blankRecipe())}>
              <Plus size={17} /> 새 레시피
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => fileInput.current?.click()}>
              <Upload size={16} /> 가져오기
            </button>
          </div>
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            aria-label="레시피 JSON 파일 가져오기"
            onChange={importRecipe}
          />
          <p className="library-note">
            <BookOpen size={14} aria-hidden="true" /> 레시피는 브라우저에 저장되며, Drive 연결 시 클라우드에도 저장됩니다.
          </p>
          <section className="drive-sync" aria-label="Google Drive 동기화">
            <h3>자동 동기화</h3>
            <DriveConnectionStatus connection={driveSync.connection} />
            <DriveSaveStatus receipt={driveSync.receipt} />
            <p className="library-note">앱 전용 공간에 저장되어 일반 Drive 파일 목록에는 표시되지 않습니다. 유효한 연결은 이 탭의 새로고침 후 자동 복원됩니다.</p>
            <button className="btn btn-secondary" type="button" disabled={driveSync.busy || !driveSync.configured} onClick={() => void (driveSync.connected ? driveSync.sync() : driveSync.connect())}>
              {driveSync.busy ? '동기화 중…' : driveSync.connected ? '지금 동기화' : 'Google Drive 연결'}
            </button>
            {driveSync.enabled && <button className="btn btn-ghost" type="button" disabled={driveSync.busy} onClick={driveSync.disconnect}>연결 해제</button>}
            {driveSync.connected && <button className="btn btn-ghost" type="button" disabled={driveSync.busy} onClick={() => void driveSync.checkConnection()}>자동 동기화 연결 확인</button>}
            <p className="library-note" role="status">{driveSync.configured ? driveSync.status : 'Google Drive 연동 설정이 필요합니다.'}</p>
          </section>
          <DriveLibrary library={library} blocked={isRunning || isPaused || editing !== null || fullscreen.active || driveSync.busy} onBusy={setDriveBusy} onImport={imported => {
            setLibrary(previous => mergeBackup(previous, imported));
            setPendingDelete(null);
            brew.reset();
          }} />
          {sidebarNotice && (
            <p className="library-error" role="alert">{sidebarNotice}</p>
          )}
        </aside>

        <section className="studio" id="brew" aria-label="추출 스튜디오">
          <article className="recipe-hero" inert={fullscreen.active}>
            <div className="hero-top">
              <div>
                <p className="eyebrow">오늘의 커피</p>
                <h2>{active.name}</h2>
              </div>
              <div className="hero-actions">
                <button className="btn btn-ghost" type="button" onClick={() => setEditing(active)}>
                  <Pencil size={16} /> 편집
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => downloadRecipe(active)}>
                  <Download size={16} /> 내보내기
                </button>
              </div>
            </div>
            {active.description.trim() && (
              <p className="recipe-description">{active.description}</p>
            )}
            <div className="recipe-chips" aria-label="추출 정보">
              <span>{active.dripper}</span>
              <span>{active.grind}</span>
              <span>{active.temperature}℃</span>
            </div>
            <dl className="recipe-stats">
              <div>
                <dt>원두</dt>
                <dd>{active.coffee}<small>g</small></dd>
              </div>
              <div>
                <dt>물</dt>
                <dd>{waterTotal}<small>g</small></dd>
              </div>
              <div>
                <dt>비율</dt>
                <dd>1:<small>{ratio}</small></dd>
              </div>
              <div>
                <dt>총 시간</dt>
                <dd>{formatTime(duration)}</dd>
              </div>
            </dl>
          </article>

          <section
            ref={fullscreen.panelRef}
            className={`brew-board${isComplete ? ' is-complete' : ''}${fullscreen.active ? ' is-fullscreen' : ''}`}
            aria-label="실시간 추출 타이머"
          >
            <div className="brew-toolbar">
              <p className="eyebrow">{fullscreen.active ? active.name : '추출 가이드'}</p>
              <button
                ref={fullscreen.buttonRef}
                className="btn btn-ghost fullscreen-toggle"
                type="button"
                aria-pressed={fullscreen.active}
                onClick={() => void fullscreen.toggle()}
              >
                {fullscreen.active ? <Minimize size={18} aria-hidden="true" /> : <Maximize size={18} aria-hidden="true" />}
                {fullscreen.active ? '전체화면 종료' : '전체화면'}
              </button>
            </div>
            {update.available && !fullscreen.active && (
              <div className="update-notice">
                <p role="status">
                  {updateRefreshBlocked
                    ? '새 버전이 있습니다. 추출·편집·전체화면을 마치면 자동으로 적용됩니다.'
                    : '새 버전을 불러올 수 있습니다.'}
                </p>
                <button className="btn btn-secondary" type="button" disabled={updateRefreshBlocked} onClick={update.refresh}>지금 적용</button>
              </div>
            )}
            <div className="brew-readout">
              <div className="clock-block">
                <p className="board-label">{isComplete ? '추출 완료' : isPaused ? '일시정지' : isRunning ? '추출 중' : '추출 준비'}</p>
                <p className="clock" role="timer" aria-label={`경과 시간 ${formatTime(brew.snapshot.elapsed)}`}>
                  {formatTime(brew.snapshot.elapsed)}
                </p>
                <p className="clock-total">전체 {formatTime(duration)}</p>
              </div>
              <div className="water-pair">
                <div className="water-block water-block-final">
                  <p className="board-label">{isComplete ? '최종 누적 물량' : '이번 단계 최종 목표'}</p>
                  <p className="water-target water-target-final">
                    {Math.round(finalStepTarget)}<span>g</span>
                  </p>
                  <p className="water-note">
                    {isComplete
                      ? `총 ${waterTotal}g · 천천히 즐기세요`
                      : step.action === 'pour'
                        ? `이번 단계에서 +${step.water}g`
                        : '이번 단계에서는 붓지 않아요'}
                  </p>
                </div>
                <div className="water-block water-block-live">
                  <p className="board-label">{isComplete ? '완료' : '지금 목표'}</p>
                  <p className="water-target water-target-live" aria-live="off">
                    {Math.round(liveTarget)}<span>g</span>
                  </p>
                  <p className="water-note">
                    {isComplete
                      ? `저울 ${waterTotal}g에서 멈추세요`
                      : step.action !== 'pour'
                        ? '붓지 않고 이 무게를 유지하세요'
                        : reachedTarget
                          ? `목표 도달 · 유량 ${stepFlowRate.toFixed(2)}g/s`
                          : `유량 ${stepFlowRate.toFixed(2)}g/s로 부으세요`}
                  </p>
                </div>
              </div>
              <p className="weigh-note">
                <Scale size={16} aria-hidden="true" /> 시작 전 저울의 영점을 맞추세요. 두 목표는 모두 누적 무게입니다.
              </p>
            </div>

            <div className="step-progress" role="progressbar" aria-label="현재 단계 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((isComplete ? 1 : stepProgress) * 100)}>
              <span style={{ transform: `scaleX(${isComplete ? 1 : stepProgress})` }} />
            </div>
            <div className="step-progress-caption">
              <span>{isComplete ? '모든 단계 완료' : `${brew.snapshot.stepIndex + 1} / ${active.steps.length} 단계`}</span>
              <span>{isComplete ? '추출 완료' : `이번 단계 ${formatTime(Math.max(0, Math.ceil(stepDuration - brew.snapshot.stepElapsed)))} 남음`}</span>
            </div>

            <div className="brew-track" aria-hidden="true">
              {schedule.map((entry, index) => {
                const share = (entry.end - entry.start) / Math.max(1, duration) * 100;
                const done = isComplete || index < brew.snapshot.stepIndex;
                const current = !isComplete && index === brew.snapshot.stepIndex;
                return (
                  <span
                    key={entry.step.id}
                    className={`track-segment action-${entry.step.action}${done ? ' is-done' : ''}${current ? ' is-current' : ''}`}
                    style={{ flexGrow: share }}
                    title={`${formatTime(entry.start)} ${ACTION_LABELS[entry.step.action]} · ${entry.step.title}`}
                  />
                );
              })}
            </div>
            <div className="track-legend" aria-hidden="true">
              <span><i className="dot dot-pour" />붓기</span>
              <span><i className="dot dot-wait" />대기</span>
              <span><i className="dot dot-action" />스월·스티어</span>
            </div>

            {isComplete ? (
              <div className="instruction-card complete-card">
                <span className="complete-mark" aria-hidden="true"><Check size={24} /></span>
                <div>
                  <p className="step-overline">추출 완료</p>
                  <h3>마지막 한 방울까지, 잘 내렸어요.</h3>
                  <p>{waterTotal}g의 물과 {active.coffee}g의 원두로 내린 커피입니다. 향을 먼저 맡고 천천히 즐겨 보세요.</p>
                </div>
              </div>
            ) : (
              <div className={`instruction-card action-${step.action}`} key={step.id}>
                <div className="instruction-head">
                  <span className="step-badge">{String(brew.snapshot.stepIndex + 1).padStart(2, '0')} 단계</span>
                  <span className="action-pill">
                    <ActionIcon action={step.action} size={15} /> {ACTION_LABELS[step.action]}
                  </span>
                  <span className="step-range">
                    {formatTime(schedule[brew.snapshot.stepIndex]?.start ?? 0)}–{formatTime(schedule[brew.snapshot.stepIndex]?.end ?? 0)}
                  </span>
                </div>
                <h3>{step.title}</h3>
                <p className="instruction-copy">
                  {isIdle ? `시작을 누르면 ‘${step.title}’ 단계가 진행됩니다. ${instructionFor(step)}` : instructionFor(step)}
                </p>
                {step.note && <p className="step-note">{step.note}</p>}
                <div className="instruction-foot">
                  <span className="water-progress">
                    {step.action === 'pour'
                      ? `추가 목표 ${pouredThisStep.toFixed(1)} / ${step.water}g · ${stepFlowRate.toFixed(2)}g/s`
                      : `누적 ${Math.round(liveTarget)}g 유지`}
                  </span>
                  {next ? (
                    <span className="next-step">
                      다음 · {formatTime(next.start)} {ACTION_LABELS[next.step.action]} <ArrowRight size={13} aria-hidden="true" />
                    </span>
                  ) : (
                    <span className="next-step">마지막 단계</span>
                  )}
                </div>
              </div>
            )}

            <div className="controls">
              {isComplete ? (
                <button className="btn btn-primary btn-large" type="button" onClick={brew.restart}>
                  <RotateCcw size={19} /> 다시 추출
                </button>
              ) : isRunning ? (
                <button className="btn btn-primary btn-large" type="button" onClick={brew.pause}>
                  <Pause size={19} fill="currentColor" /> 일시정지
                </button>
              ) : isPaused ? (
                <button className="btn btn-primary btn-large" type="button" onClick={start}>
                  <Play size={19} fill="currentColor" /> 계속하기
                </button>
              ) : (
                <button className="btn btn-primary btn-large" type="button" onClick={start}>
                  <Play size={19} fill="currentColor" /> 추출 시작
                </button>
              )}
              <button
                className="btn btn-on-dark"
                type="button"
                onClick={brew.reset}
                disabled={isIdle}
                title="타이머를 처음 상태로 되돌립니다"
              >
                <RotateCcw size={17} /> 처음부터
              </button>
            </div>
            {!fullscreen.active && (
              <p className="timer-help" role="status">
                {brew.notice || (isRunning ? '다른 탭을 잠시 봐도 실제 경과 시간에 맞춰 다시 표시됩니다.' : '소리 알림을 켜 두면 단계가 바뀔 때 알려드려요.')}
              </p>
            )}
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {isComplete
                ? '추출이 완료되었습니다.'
                : `${brew.snapshot.stepIndex + 1}단계, ${ACTION_LABELS[step.action]}, ${step.title}. ${instructionFor(step)}`}
            </p>
          </section>

          <section className="steps-panel" aria-labelledby="steps-heading" inert={fullscreen.active}>
            <div className="steps-panel-head">
              <div>
                <p className="eyebrow">단계별 안내</p>
                <h3 id="steps-heading">전체 추출 흐름</h3>
              </div>
              <span className="steps-total">{active.steps.length}단계 · {waterTotal}g</span>
            </div>
            <ol className="step-list">
              {schedule.map((entry, index) => {
                const done = isComplete || index < brew.snapshot.stepIndex;
                const current = !isComplete && index === brew.snapshot.stepIndex;
                return (
                  <li
                    key={entry.step.id}
                    className={`step-row${done ? ' is-done' : ''}${current ? ' is-current' : ''}`}
                    aria-current={current ? 'step' : undefined}
                  >
                    <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
                    <span className="step-time">{formatTime(entry.start)}<small>–{formatTime(entry.end)}</small></span>
                    <span className="step-action">
                      <ActionIcon action={entry.step.action} size={16} /> {ACTION_LABELS[entry.step.action]}
                    </span>
                    <span className="step-name">
                      {entry.step.title}
                      {entry.step.note && <small>{entry.step.note}</small>}
                    </span>
                    <span className="step-water">
                      {entry.step.action === 'pour' ? `+${entry.step.water}g` : '—'}
                      <small>누적 {entry.waterAfter}g</small>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        </section>
      </main>

      <footer className="footer" inert={fullscreen.active}>
        <p>직접 만든 레시피로 더 나은 한 잔을.</p>
        <p>
          참고한 프로젝트:{' '}
          <a href="https://github.com/quincarter/brew-me-app-lit" target="_blank" rel="noreferrer">BrewMe</a>
          {' · '}
          <a href="https://gota.cafe/en/app" target="_blank" rel="noreferrer">Gota</a>
          {' · '}
          <a href="https://github.com/licht0182/biff-timetable" target="_blank" rel="noreferrer">biff-timetable</a>
        </p>
      </footer>

      {editing && (
        <RecipeEditor
          recipe={editing}
          onSave={saveEditedRecipe}
          onCancel={() => setEditing(null)}
        />
      )}
      {flash && <p className="toast" role="status">{flash}</p>}
    </div>
  );
}

export default App;

