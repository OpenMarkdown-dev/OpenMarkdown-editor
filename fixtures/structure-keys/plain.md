# 不在任何结构里

结构键黄金用例(spec: structure-input)。`‸` 是光标。

## 段落里 Tab 是默认缩进
keys: Tab

```md
一段话‸
```

```md
  一段话‸
```

## 段落里 Shift-Tab 是默认反缩进
keys: Shift-Tab

```md
  一段话‸
```

```md
一段话‸
```

## 段落里 Enter 是普通换行
keys: Enter

```md
一段‸话
```

```md
一段
‸话
```

## 段落里 Backspace 删一个字
keys: Backspace

```md
一段话‸
```

```md
一段‸
```

## 阅读模式 Enter 不改文档
keys: Enter
mode: reading
```md
- 一项‸
```

```md
- 一项‸
```

