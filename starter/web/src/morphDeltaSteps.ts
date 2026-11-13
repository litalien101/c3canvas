export type MorphDeltaStep<T> = {
  records: T[];
  amount: number;
};

export function getMorphDeltaSteps<T>(
  previousValue: number,
  nextValue: number,
  target: { positive: T[]; negative: T[] },
): MorphDeltaStep<T>[] {
  if (
    previousValue !== 0
    && nextValue !== 0
    && Math.sign(previousValue) === Math.sign(nextValue)
  ) {
    const amount = Math.abs(nextValue) - Math.abs(previousValue);
    return amount === 0
      ? []
      : [{
        records: previousValue > 0 ? target.positive : target.negative,
        amount,
      }];
  }

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
