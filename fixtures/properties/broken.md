---
title: 正常
- 顶层直接写了一个列表项
---

# 解析失败(change: properties-block)

上面的 frontmatter 在顶层混进了一个列表项,既不是「名字: 值」也不属于任何属性。预期:**不呈现 Properties 块**,直接显示 YAML 源码,内容完整,不报错。
