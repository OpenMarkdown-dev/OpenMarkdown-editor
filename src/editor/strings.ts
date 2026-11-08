import { editorEnvironment } from "./environment";

// Spec: editor-host / 编辑器自带界面文字、语言由宿主指定. The app's dictionary
// (`lib/i18n.ts`) holds no copy of these keys and the editor never imports it;
// no editor module may call `editorString` at top level (gate:
// `editorStrings.gate.test.ts`).
/**
 * The editor's own UI strings: exactly the words the editor draws — the find
 * panel, the code-copy button, fold handles, the properties block, image and
 * link chips, render failures — in every language it ships.
 *
 * The language is the host's to pick, through the editor environment's
 * `language`; it is read when a string is drawn, never at module evaluation.
 * Without a host language, or with one the editor does not ship, the editor
 * speaks English: a fixed default, not a guess from the browser, so the editor
 * behaves the same in every host and the host stays the only owner of
 * language policy.
 */

// Every app language must be on this list (`lib/i18n.test.ts`).
/** The languages the editor ships (`zh` is Simplified Chinese). */
export const EDITOR_LANGS = ["zh", "ja", "ko", "en"] as const;

/** A language the editor's own UI words ship in (`EditorEnvironment.language`). */
export type EditorLang = (typeof EDITOR_LANGS)[number];

/** Used when the host names no language, or one the editor does not ship. */
export const DEFAULT_EDITOR_LANG: EditorLang = "en";

/** zh is the source of truth: its keys type-check every other table for completeness. */
const zh = {
  "find.placeholder": "查找",
  "find.replacePlaceholder": "替换为",
  "find.previous": "上一个",
  "find.next": "下一个",
  "find.matchCase": "区分大小写",
  "find.replace": "替换",
  "find.replaceAll": "全部替换",
  "find.count": "{current}/{total}",
  "find.close": "关闭 (Esc)",
  "widget.copyCode": "复制代码",
  "widget.fold": "折叠",
  "widget.unfold": "展开",
  "widget.expandLink": "点击编辑链接地址",
  "widget.imageLoadFailed": "⚠ 图片加载失败: {src}",
  "widget.resizeImage": "拖动调整图片大小",
  "widget.renderFailed": "无法渲染:{reason}",
  "props.add": "+ 添加属性",
  "props.editSource": "按源码编辑",
  "props.delete": "删除属性",
  "props.newName": "新属性",
} as const;

export type EditorStringKey = keyof typeof zh;

const en: Record<EditorStringKey, string> = {
  "find.placeholder": "Find",
  "find.replacePlaceholder": "Replace with",
  "find.previous": "Previous match",
  "find.next": "Next match",
  "find.matchCase": "Match case",
  "find.replace": "Replace",
  "find.replaceAll": "Replace all",
  "find.count": "{current}/{total}",
  "find.close": "Close (Esc)",
  "widget.copyCode": "Copy code",
  "widget.fold": "Fold",
  "widget.unfold": "Unfold",
  "widget.expandLink": "Click to edit the link URL",
  "widget.imageLoadFailed": "⚠ Failed to load image: {src}",
  "widget.resizeImage": "Drag to resize",
  "widget.renderFailed": "Couldn't render: {reason}",
  "props.add": "+ Add property",
  "props.editSource": "Edit as source",
  "props.delete": "Delete property",
  "props.newName": "property",
};

const ja: Record<EditorStringKey, string> = {
  "find.placeholder": "検索",
  "find.replacePlaceholder": "置換後のテキスト",
  "find.previous": "前へ",
  "find.next": "次へ",
  "find.matchCase": "大文字と小文字を区別",
  "find.replace": "置換",
  "find.replaceAll": "すべて置換",
  "find.count": "{current}/{total}",
  "find.close": "閉じる (Esc)",
  "widget.copyCode": "コードをコピー",
  "widget.fold": "折りたたむ",
  "widget.unfold": "展開",
  "widget.expandLink": "クリックしてリンク URL を編集",
  "widget.imageLoadFailed": "⚠ 画像を読み込めませんでした: {src}",
  "widget.resizeImage": "ドラッグでサイズを変更",
  "widget.renderFailed": "表示できません:{reason}",
  "props.add": "+ プロパティを追加",
  "props.editSource": "ソースとして編集",
  "props.delete": "プロパティを削除",
  "props.newName": "プロパティ",
};

const ko: Record<EditorStringKey, string> = {
  "find.placeholder": "찾기",
  "find.replacePlaceholder": "바꿀 내용",
  "find.previous": "이전 결과",
  "find.next": "다음 결과",
  "find.matchCase": "대소문자 구분",
  "find.replace": "바꾸기",
  "find.replaceAll": "모두 바꾸기",
  "find.count": "{current}/{total}",
  "find.close": "닫기(Esc)",
  "widget.copyCode": "코드 복사",
  "widget.fold": "접기",
  "widget.unfold": "펼치기",
  "widget.expandLink": "클릭해서 링크 URL 편집",
  "widget.imageLoadFailed": "⚠ 이미지를 불러오지 못했습니다: {src}",
  "widget.resizeImage": "드래그해서 크기 조절",
  "widget.renderFailed": "렌더링할 수 없습니다: {reason}",
  "props.add": "+ 속성 추가",
  "props.editSource": "소스로 편집",
  "props.delete": "속성 삭제",
  "props.newName": "속성",
};

/** Every language's table — for the gates. */
export const EDITOR_STRINGS: Record<EditorLang, Record<EditorStringKey, string>> = { zh, en, ja, ko };

/** The language the host picked, or the default. Read at call time, never cached. */
export function editorLang(): EditorLang {
  const lang = editorEnvironment().language;
  return lang && (EDITOR_LANGS as readonly string[]).includes(lang) ? lang : DEFAULT_EDITOR_LANG;
}

/** A UI string in the host's language, `{name}` placeholders filled from `params`. */
export function editorString(key: EditorStringKey, params?: Record<string, string>): string {
  let out: string = EDITOR_STRINGS[editorLang()][key];
  if (params) for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, v);
  return out;
}
