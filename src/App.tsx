import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  Download,
  Droplets,
  Github,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
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
import { ACTION_LABELS, formatTime, getStepSchedule, totalDuration, totalWater } from './recipe';
import { useBrewTimer } from './useBrewTimer';
import RecipeEditor from './RecipeEditor';
import { downloadRecipe, loadLibrary, readRecipeFile, saveLibrary } from './storage';
import type { Library } from './storage';

const ACTION_ICONS: Record<StepAction, LucideIcon> = {
  pour: Droplets,
  wait: Timer,
  swirl: Waves,
  stir: Utensils,
};

const SOUND_KEY = 'pour-guide.sound.v1';

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
      { id: crypto.randomUUID(), title: '블룸', action: 'pour', duration: 30, water: 30, note: '원두 전체를 적시며 천천히 부어 주세요.' },
      { id: crypto.randomUUID(), title: '블룸 대기', action: 'wait', duration: 30, water: 0, note: '가스가 빠져나가도록 기다립니다.' },
      { id: crypto.randomUUID(), title: '본 추출', action: 'pour', duration: 60, water: 180, note: '중심에서 바깥으로 나선을 그리세요.' },
      { id: crypto.randomUUID(), title: '마무리', action: 'wait', duration: 45, water: 0, note: '드립이 끝날 때까지 기다립니다.' },
    ],
  };
}

function instructionFor(step: RecipeStep): string {
  switch (step.action) {
    case 'pour':
      return `${step.duration}초 동안 물 ${step.water}g을 추가로 부으세요.`;
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
  const hydrated = useRef(false);
  const [library, setLibrary] = useState<Library>(loadLibrary);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [sound, setSound] = useState(loadSoundPreference);
  const [flash, setFlash] = useState('');
  const [sidebarNotice, setSidebarNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
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

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
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
    if (!pendingDelete) return;
    const timeout = window.setTimeout(() => setPendingDelete(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [pendingDelete]);

  const selectRecipe = (id: string) => {
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
      <a className="skip-link" href="#brew">추출 안내로 건너뛰기</a>
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Pour Guide 홈">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40" width="30" height="30" fill="none">
              <path d="M8 13.5h24L22.5 29h-5L8 13.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M14 8h12M15 33h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span>
            <strong>POUR GUIDE</strong>
            <small>나만의 커피 리추얼</small>
          </span>
        </a>
        <div className="topbar-actions">
          <button
            className="icon-button"
            type="button"
            aria-pressed={sound}
            aria-label={sound ? '소리 알림 끄기' : '소리 알림 켜기'}
            title={sound ? '소리 알림 끄기' : '소리 알림 켜기'}
            onClick={() => {
              if (!sound) brew.prepareSound();
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
        <aside className="library" aria-label="레시피 보관함">
          <div className="library-heading">
            <p className="eyebrow">MY RECIPES</p>
            <h1>브루 라이브러리</h1>
            <p>레시피를 고르고, 물과 행동이 필요한 순간을 놓치지 마세요.</p>
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
            <BookOpen size={14} aria-hidden="true" /> 레시피는 이 브라우저에만 저장됩니다.
          </p>
          {sidebarNotice && (
            <p className="library-error" role="alert">{sidebarNotice}</p>
          )}
        </aside>

        <section className="studio" id="brew" aria-label="추출 스튜디오">
          <article className="recipe-hero">
            <div className="hero-top">
              <div>
                <p className="eyebrow">TODAY&apos;S BREW</p>
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
            <p className="recipe-description">{active.description}</p>
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

          <section className={`brew-board${isComplete ? ' is-complete' : ''}`} aria-label="실시간 추출 타이머">
            <div className="board-glow" aria-hidden="true" />
            <div className="brew-readout">
              <div className="clock-block">
                <p className="board-label">{isComplete ? 'BREW COMPLETE' : isPaused ? 'PAUSED' : isRunning ? 'BREWING' : 'READY'}</p>
                <p className="clock" role="timer" aria-label={`경과 시간 ${formatTime(brew.snapshot.elapsed)}`}>
                  {formatTime(brew.snapshot.elapsed)}
                </p>
                <p className="clock-total">of {formatTime(duration)}</p>
              </div>
              <div className="water-block">
                <p className="board-label">{isIdle ? '첫 단계 목표' : isComplete ? '최종 누적 물량' : '목표 누적 물량'}</p>
                <p className="water-target">
                  {Math.round(isIdle && step.action === 'pour' ? schedule[0].waterAfter : brew.snapshot.targetWater)}<span>g</span>
                </p>
                <p className="water-note">
                  {isComplete ? `총 ${waterTotal}g · 천천히 즐기세요` : `${isIdle ? `시작 후 ${step.duration}초 동안` : step.action === 'pour' ? `이번 단계 +${step.water}g` : '이번 단계에서는 붓지 않아요'} · 총 ${waterTotal}g`}
                </p>
              </div>
            </div>

            <div className="step-progress" aria-hidden="true">
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
              <span className="track-marker" style={{ left: `${(isComplete ? 1 : brew.snapshot.progress) * 100}%` }} />
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
                  <span className="step-badge">STEP {String(brew.snapshot.stepIndex + 1).padStart(2, '0')}</span>
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
                      ? `${Math.round(step.water * stepProgress)} / ${step.water}g 부음`
                      : `누적 ${Math.round(brew.snapshot.targetWater)}g 유지`}
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
            <p className="timer-help" role="status">
              {brew.notice || (isRunning ? '다른 탭을 잠시 봐도 실제 경과 시간에 맞춰 다시 표시됩니다.' : '소리 알림을 켜 두면 단계가 바뀔 때 알려드려요.')}
            </p>
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {isComplete
                ? '추출이 완료되었습니다.'
                : `${brew.snapshot.stepIndex + 1}단계, ${ACTION_LABELS[step.action]}, ${step.title}. ${instructionFor(step)}`}
            </p>
          </section>

          <section className="steps-panel" aria-labelledby="steps-heading">
            <div className="steps-panel-head">
              <div>
                <p className="eyebrow">THE POUR</p>
                <h3 id="steps-heading">전체 추출 흐름</h3>
              </div>
              <span className="steps-total">{active.steps.length} steps · {waterTotal}g</span>
            </div>
            <ol className="step-list">
              {schedule.map((entry, index) => {
                const done = isComplete || index < brew.snapshot.stepIndex;
                const current = !isComplete && index === brew.snapshot.stepIndex;
                return (
                  <li
                    key={entry.step.id}
                    className={`step-row${done ? ' is-done' : ''}${current ? ' is-current' : ''}`}
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

      <footer className="footer">
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
