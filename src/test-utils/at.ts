/**
 * 测试专用：带断言的数组下标访问。
 *
 * tsconfig 开启了 `noUncheckedIndexedAccess`，`arr[0]` 的类型是 `T | undefined`，
 * 测试里大量直接下标访问（`items[0].type`、`mock.calls[0][0]`）会因此报类型错。
 * 与其在每个断言处散落 `!`，不如统一走这个帮助函数：
 * 元素缺失时**立即抛出带下标的错误**，而不是让断言在 `undefined` 上静默失败。
 */
export function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) {
    throw new Error(`expected index ${i} to exist (length=${arr.length})`);
  }
  return v;
}
