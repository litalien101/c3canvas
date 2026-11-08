export type MorphDeltaStep<T> = {
  records: T[];
  amount: number;
};

export function getMorphDeltaSteps<T>(
  previousValue: number,
  nextValue: number,
  target: { positive: T[]; negative: T[] },
): MorphDeltaStep<T>[] {
  const steps: MorphDeltaStep<T>[] = [];
  if (previousValue !== 0) {
    steps.push({
      records: previousValue > 0 ? target.positive : target.negative,
      amount: -Math.abs(previousValue),
    });
  }
  if (nextValue !== 0) {
    steps.push({
      records: nextValue > 0 ? target.positive : target.negative,
      amount: Math.abs(nextValue),
    });
  }
  return steps;
}
