type Answer = 1 | 5;
type DimensionKey = "IE" | "SN" | "FT" | "JP";

interface Question {
  readonly image: string;
  readonly left: string;
  readonly right: string;
}

interface DimensionResult {
  readonly key: DimensionKey;
  readonly leftLetter: string;
  readonly rightLetter: string;
  readonly score: number;
  readonly rightPercent: number;
  readonly chosenLetter: string;
  readonly chosenLabel: string;
}

const QUESTIONS: readonly Question[] = [
  ["makes lists", "relies on memory"], ["skeptical", "wants to believe"],
  ["bored by time alone", "needs time alone"], ["accepts things as they are", "wants to improve things"],
  ["keeps a clean room", "puts things wherever convenient"], ["values a human mindset", "values mechanical precision"],
  ["energetic", "mellow"], ["prefers multiple choice", "prefers essay answers"],
  ["chaotic", "organized"], ["easily hurt", "thick-skinned"],
  ["works best in groups", "works best alone"], ["focused on the present", "focused on the future"],
  ["plans far ahead", "plans at the last minute"], ["wants respect", "wants love"],
  ["worn out by parties", "energized by parties"], ["fits in", "stands out"],
  ["keeps options open", "commits"], ["fixes things", "helps people"],
  ["talks more", "listens more"], ["describes what happened", "describes what it meant"],
  ["starts right away", "procrastinates"], ["follows the heart", "follows the head"],
  ["stays home", "goes out"], ["wants the big picture", "wants the details"],
  ["improvises", "prepares"], ["prioritizes justice", "prioritizes compassion"],
  ["speaks quietly", "calls loudly"], ["theoretical", "empirical"],
  ["works hard", "plays hard"], ["uncomfortable with emotions", "values emotions"],
  ["likes performing publicly", "avoids public speaking"], ["asks who, what, and when", "asks why"]
].map(([left, right], index): Question => ({
  image: `assets/question-${String(index + 1).padStart(2, "0")}.png`,
  left: left ?? "Left preference",
  right: right ?? "Right preference"
}));

const TYPE_NAMES: Readonly<Record<string, string>> = {
  INTJ: "The Architect", INTP: "The Thinker", ENTJ: "The Commander", ENTP: "The Explorer",
  INFJ: "The Advocate", INFP: "The Mediator", ENFJ: "The Guide", ENFP: "The Spark",
  ISTJ: "The Inspector", ISFJ: "The Protector", ESTJ: "The Organizer", ESFJ: "The Connector",
  ISTP: "The Craftsperson", ISFP: "The Artist", ESTP: "The Dynamo", ESFP: "The Entertainer"
};

const TYPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  I: "You tend to recharge through reflection and focused space.", E: "You tend to gain energy through interaction and activity.",
  S: "You tend to notice concrete information and what is happening now.", N: "You tend to notice patterns, possibilities, and underlying meaning.",
  F: "You tend to weigh values, relationships, and human impact.", T: "You tend to weigh logic, consistency, and objective principles.",
  J: "You tend to prefer structure, decisions, and preparation.", P: "You tend to prefer flexibility, options, and adaptation."
};

const requireElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing element #${id}`);
  return element as T;
};

const card = requireElement<HTMLElement>("question-card");
const image = requireElement<HTMLImageElement>("question-image");
const quizScreen = requireElement<HTMLElement>("quiz-screen");
const resultScreen = requireElement<HTMLElement>("result-screen");
const progressLabel = requireElement<HTMLElement>("progress-label");
const progressFill = requireElement<HTMLElement>("progress-fill");
const undoButton = requireElement<HTMLButtonElement>("undo-button");
const leftButton = requireElement<HTMLButtonElement>("left-button");
const rightButton = requireElement<HTMLButtonElement>("right-button");
const restartButton = requireElement<HTMLButtonElement>("restart-button");
const leftTint = card.querySelector<HTMLElement>(".choice-tint-left");
const rightTint = card.querySelector<HTMLElement>(".choice-tint-right");
if (!leftTint || !rightTint) throw new Error("Missing choice tint elements");

let answers: Answer[] = [];
let startX = 0;
let currentX = 0;
let dragging = false;
let animating = false;

const renderQuestion = (): void => {
  const question = QUESTIONS[answers.length];
  if (!question) { renderResult(); return; }
  image.src = question.image;
  image.alt = `Left: ${question.left}. Right: ${question.right}.`;
  progressLabel.textContent = `Question ${answers.length + 1} of ${QUESTIONS.length}`;
  progressFill.style.width = `${(answers.length / QUESTIONS.length) * 100}%`;
  undoButton.disabled = answers.length === 0;
  resetCard();
  preloadNextImage();
};

const preloadNextImage = (): void => {
  const next = QUESTIONS[answers.length + 1];
  if (next) new Image().src = next.image;
};

const resetCard = (): void => {
  card.classList.add("settling");
  card.classList.remove("dragging");
  card.style.transform = "translateX(0) rotate(0deg)";
  leftTint.style.opacity = "0";
  rightTint.style.opacity = "0";
  window.setTimeout(() => card.classList.remove("settling"), 240);
};

const updateCardPosition = (deltaX: number): void => {
  const rotation = Math.max(-7, Math.min(7, deltaX / 45));
  card.style.transform = `translateX(${deltaX}px) rotate(${rotation}deg)`;
  const intensity = Math.min(.95, Math.abs(deltaX) / 180);
  leftTint.style.opacity = deltaX < 0 ? String(intensity) : "0";
  rightTint.style.opacity = deltaX > 0 ? String(intensity) : "0";
};

const choose = (answer: Answer): void => {
  if (animating || answers.length >= QUESTIONS.length) return;
  animating = true;
  const direction = answer === 1 ? -1 : 1;
  card.classList.add("settling");
  card.style.transform = `translateX(${direction * 130}%) rotate(${direction * 7}deg)`;
  answers.push(answer);
  window.setTimeout(() => {
    animating = false;
    renderQuestion();
  }, 220);
};

const undo = (): void => {
  if (animating || answers.length === 0) return;
  answers.pop();
  resultScreen.hidden = true;
  quizScreen.hidden = false;
  renderQuestion();
};

const answerAt = (questionNumber: number): number => answers[questionNumber - 1] ?? 3;

const calculateDimensions = (): readonly DimensionResult[] => {
  const q = answerAt;
  const raw: Readonly<Record<DimensionKey, number>> = {
    IE: 30 - q(3) - q(7) - q(11) + q(15) - q(19) + q(23) + q(27) - q(31),
    SN: 12 + q(4) + q(8) + q(12) + q(16) + q(20) - q(24) - q(28) + q(32),
    FT: 30 - q(2) + q(6) + q(10) - q(14) - q(18) + q(22) - q(26) - q(30),
    JP: 18 + q(1) + q(5) - q(9) + q(13) - q(17) + q(21) - q(25) + q(29)
  };
  const definitions: readonly [DimensionKey, string, string, string, string][] = [
    ["IE", "I", "E", "Introversion", "Extraversion"],
    ["SN", "S", "N", "Sensing", "Intuition"],
    ["FT", "F", "T", "Feeling", "Thinking"],
    ["JP", "J", "P", "Judging", "Perceiving"]
  ];
  return definitions.map(([key, leftLetter, rightLetter, leftLabel, rightLabel]): DimensionResult => {
    const score = raw[key];
    const rightPercent = Math.max(0, Math.min(100, ((score - 8) / 32) * 100));
    const chooseRight = score > 24;
    return { key, leftLetter, rightLetter, score, rightPercent, chosenLetter: chooseRight ? rightLetter : leftLetter, chosenLabel: chooseRight ? rightLabel : leftLabel };
  });
};

const renderResult = (): void => {
  const dimensions = calculateDimensions();
  const type = dimensions.map((dimension) => dimension.chosenLetter).join("");
  const name = TYPE_NAMES[type] ?? "Your unique mix";
  requireElement<HTMLElement>("result-code").innerHTML = [...type].map((letter) => `<span>${letter}</span>`).join("");
  requireElement<HTMLElement>("result-title").textContent = name;
  requireElement<HTMLElement>("result-description").textContent = [...type].map((letter) => TYPE_DESCRIPTIONS[letter]).filter(Boolean).join(" ");
  requireElement<HTMLElement>("dimension-results").innerHTML = dimensions.map((dimension) => `
    <article class="dimension-card">
      <div class="dimension-labels"><span>${dimension.leftLetter}</span><span>${dimension.rightLetter}</span></div>
      <div class="dimension-bar"><span style="width:${dimension.rightPercent.toFixed(1)}%"></span></div>
      <div class="dimension-preference">Preference: ${dimension.chosenLabel} · ${Math.round(Math.abs(dimension.rightPercent - 50) * 2)}% strength</div>
    </article>`).join("");
  progressFill.style.width = "100%";
  quizScreen.hidden = true;
  resultScreen.hidden = false;
  undoButton.disabled = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
};

card.addEventListener("pointerdown", (event: PointerEvent) => {
  if (animating) return;
  dragging = true;
  startX = event.clientX;
  currentX = startX;
  card.classList.add("dragging");
  card.setPointerCapture(event.pointerId);
});

card.addEventListener("pointermove", (event: PointerEvent) => {
  if (!dragging) return;
  currentX = event.clientX;
  updateCardPosition(currentX - startX);
});

const finishDrag = (): void => {
  if (!dragging) return;
  dragging = false;
  const deltaX = currentX - startX;
  card.classList.remove("dragging");
  if (Math.abs(deltaX) >= Math.min(120, card.clientWidth * .18)) choose(deltaX < 0 ? 1 : 5);
  else resetCard();
};

card.addEventListener("pointerup", finishDrag);
card.addEventListener("pointercancel", finishDrag);
card.addEventListener("click", (event: MouseEvent) => {
  if (Math.abs(currentX - startX) > 8 || animating) return;
  const bounds = card.getBoundingClientRect();
  choose(event.clientX < bounds.left + bounds.width / 2 ? 1 : 5);
});
document.addEventListener("keydown", (event: KeyboardEvent) => {
  if (quizScreen.hidden) return;
  if (event.key === "ArrowLeft") { event.preventDefault(); choose(1); }
  if (event.key === "ArrowRight") { event.preventDefault(); choose(5); }
});
leftButton.addEventListener("click", () => choose(1));
rightButton.addEventListener("click", () => choose(5));
undoButton.addEventListener("click", undo);
restartButton.addEventListener("click", () => { answers = []; resultScreen.hidden = true; quizScreen.hidden = false; renderQuestion(); window.scrollTo({ top: 0, behavior: "smooth" }); });

renderQuestion();
