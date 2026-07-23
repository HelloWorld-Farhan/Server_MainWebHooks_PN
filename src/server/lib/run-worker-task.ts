export function runWorkerTask(
  workerName: string,
  task: () => Promise<void>,
): void {
  void task().catch((error) => {
    console.error(`[${workerName}] worker task failed`, error);
  });
}
