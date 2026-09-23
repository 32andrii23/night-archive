export type Trick = {
  type: string;
  label: string;
  detail: string;
  cost: number;
  key?: string;
  keyLabel?: string;
  group: "sound" | "vision" | "control" | "voice";
  input?: "radio" | "write" | "voice";
};

/** Server costs and cooldowns live in lib/game.ts; these mirror them for display. */
export const TRICKS: Trick[] = [
  { type: "whisper", label: "Шёпот", detail: "Неразборчивый шёпот прямо за спиной друга.", cost: 12, key: "Digit1", keyLabel: "1", group: "sound" },
  { type: "footsteps", label: "Шаги", detail: "Кто-то подходит сзади — и никого нет.", cost: 10, key: "Digit2", keyLabel: "2", group: "sound" },
  { type: "doorSlam", label: "Хлопок", detail: "Ближайшая к другу дверь с грохотом захлопывается.", cost: 16, key: "Digit3", keyLabel: "3", group: "sound" },
  { type: "flicker", label: "Фонарь", detail: "Фонарь друга мигает и гаснет почти на пять секунд.", cost: 22, key: "Digit4", keyLabel: "4", group: "control" },
  { type: "shadow", label: "Тень", detail: "Высокий силуэт в конце его взгляда. Исчезает, когда на него посветят.", cost: 20, key: "Digit5", keyLabel: "5", group: "vision" },
  { type: "phantom", label: "Двойник", detail: "Твой человеческий облик машет другу издалека и уходит в темноту.", cost: 26, key: "Digit6", keyLabel: "6", group: "vision" },
  { type: "scare", label: "Скример", detail: "Лицо на весь экран и крик. Работает на любом расстоянии.", cost: 32, key: "Digit7", keyLabel: "7", group: "vision" },
  { type: "glitch", label: "Фейк-лаг", detail: "Картинка и звук друга «зависают»… а потом он видит лицо.", cost: 20, key: "Digit8", keyLabel: "8", group: "vision" },
  { type: "blackout", label: "Блэкаут", detail: "Гасит весь свет в его части корпуса на 12 секунд.", cost: 28, key: "Digit9", keyLabel: "9", group: "control" },
  { type: "lock", label: "Заклинить", detail: "Главный выход не открывается 8 секунд. Только после питания.", cost: 30, key: "Digit0", keyLabel: "0", group: "control" },
  { type: "radio", label: "Рация", detail: "Сообщение по рации от твоего имени — заманивай куда угодно.", cost: 6, key: "KeyR", keyLabel: "R", group: "voice", input: "radio" },
  { type: "write", label: "Кровью", detail: "Любая надпись кровью на стене прямо перед другом.", cost: 18, key: "KeyT", keyLabel: "T", group: "voice", input: "write" },
  { type: "voice", label: "Голос", detail: "Браузер друга медленно произносит фразу низким голосом.", cost: 16, key: "KeyV", keyLabel: "V", group: "voice", input: "voice" },
  { type: "breath", label: "Дыхание", detail: "Тяжёлое дыхание у самого уха.", cost: 12, group: "sound" },
  { type: "knock", label: "Стук", detail: "Три удара в стену совсем рядом.", cost: 8, group: "sound" },
  { type: "laugh", label: "Шкатулка", detail: "В соседней комнате заводится музыкальная шкатулка.", cost: 14, group: "sound" },
  { type: "phone", label: "Телефон", detail: "Неподалёку звонит старый телефон.", cost: 14, group: "sound" },
];
export const HOTBAR = TRICKS.filter(t => t.keyLabel && /^\d$/.test(t.keyLabel));

export const RADIO_PRESETS = [
  "Эй, ты где? Я у морга, иди сюда.",
  "Я нашёл выход! Беги в гидротерапию!",
  "Тут кто-то есть… не шевелись.",
  "Почему ты стоишь у меня за спиной?",
  "Помоги… оно меня держит…",
  "Я вижу твой фонарь.",
  "Не оборачивайся.",
  "Это был не я рядом с тобой.",
];
export const WRITE_PRESETS = ["ОБЕРНИСЬ", "Я ЗА ТОБОЙ", "НЕ ДЫШИ", "БЕГИ", "Я ВИЖУ ТЕБЯ", "ТЫ ОСТАНЕШЬСЯ"];
export const VOICE_PRESETS = ["Я тебя вижу", "Обернись", "Ты не выйдешь отсюда", "Мы приехали вдвоём. Уедет один.", "Я стою за дверью"];
