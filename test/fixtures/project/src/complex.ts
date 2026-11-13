export function classify(values: number[]): string[] {
  const labels: string[] = [];
  for (const value of values) {
    if (value > 0) {
      if (value % 2 === 0) {
        labels.push('positive even');
      } else if (value % 3 === 0) {
        labels.push('positive multiple of three');
      } else {
        labels.push('positive');
      }
    } else {
      labels.push(value === 0 ? 'zero' : 'negative');
    }
  }
  return labels;
}
