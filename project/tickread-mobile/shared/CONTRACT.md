# tickread Mobile / Unity 共享内容契约

**版本：** Draft v1  
**权威设计：** [../DESIGN.md](../DESIGN.md)

## 目的

让 PWA、Capacitor 原生壳与 Unity 读取相同的题库和会话资料，同时各自使用适合其
平台的 UI 与动画。共享 JSON 是内容层契约，不是 UI 或游戏引擎 API。

## QuestionDefinition

```json
{
  "id": "stable-question-hash",
  "assetClass": "equity",
  "timeframe": "1d",
  "horizon": 5,
  "symbol": "AAPL",
  "startTime": 1741132800,
  "endTime": 1741737600,
  "setup": [{ "o": 100, "h": 102, "l": 99, "c": 101, "v": 1200000 }],
  "future": [{ "o": 101, "h": 104, "l": 100, "c": 103, "v": 1300000 }],
  "answer": "up"
}
```

`symbol`、`startTime`、`endTime` 必须在客户端提交答案前隐藏；它们不是判定输入。
时间戳为 Unix UTC 秒。`setup`、`future` 中的 OHLCV 数值保留完整精度。

## SessionRecord

```json
{
  "schemaVersion": 1,
  "questionId": "stable-question-hash",
  "given": "up",
  "answer": "up",
  "correct": true,
  "responseMs": 834,
  "answeredAt": "2026-08-15T20:00:00Z"
}
```

客户端必须以 `answer` 与 `given` 的相等性计算 `correct`，并可在导入时复算验证。
未知字段应被忽略，以保证旧客户端能读取未来新增的展示元数据。

## 兼容性验收

每次修改题库或统计规则时，PWA 与 Unity 必须针对同一组 fixture 验证：

1. 正确方向相同；
2. 同一组 `SessionRecord` 的总命中率相同；
3. 按资产类别、周期和预测跨度的分组统计相同；
4. 作答前 UI 不渲染 `symbol`、`startTime` 或 `endTime`；
5. 揭晓后 UI 显示三者，并以设备语言格式化日期。
