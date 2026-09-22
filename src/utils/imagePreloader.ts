/**
 * 预加载单个图片
 * @param url 图片 URL
 * @returns Promise<void>
 */
export const preloadImage = async (url: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to preload image: ${url}`));
    img.src = url;
  });
};

/**
 * 批量预加载图片
 * @param urls 图片 URL 数组
 * @returns Promise<void>
 */
export const preloadImages = async (urls: string[]): Promise<void> => {
  // 并行预加载所有图片，忽略失败的图片
  await Promise.all(urls.map(url => preloadImage(url).catch(() => {})));
};
