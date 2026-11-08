---
status: drafft
---

# Spel chek test

This sentense has a mispelled word and anothr one.

Inline `codde wordz` here and a [linkk text](https://exampel.com/pathh) end.

Bare URL https://exampel.com/fooo here.

**bolld text** and *itallic*.

```
fenced codde blok wordz
```

中文混排 with a tyop 里面有中文。

The quick brown fox has a tyop 中文 and keeps going with english sentense.

The recieve definately accomodate.

- a list item with a wrng word
- [ ] a task with a mistaek

> a quoted line with a quoet typo

An <abbr title="htmll">HTML</abbr> attribute and $mathh$ stay quiet.

| Day | Note |
| --- | --- |
| Wendsday | recieve |

<!--
Expected with 拼写检查 on (spellcheck, design D5: the system identifies the
language per paragraph):
- red line: chek, sentense, mispelled, anothr, linkk, bolld, itallic, tyop and
  sentense in the English-dominant mixed line, recieve, definately, accomodate,
  wrng, mistaek, quoet
- no red line: Spel (a known word), drafft (frontmatter value, also while
  editing it), codde wordz (inline code), exampel / pathh / fooo (link target,
  bare URL), codde blok wordz (fenced code), tyop in the Chinese-dominant line,
  htmll / mathh (HTML, math), Wendsday / recieve in the table while it is
  rendered — both get red lines once you click into their cell to edit it
-->
