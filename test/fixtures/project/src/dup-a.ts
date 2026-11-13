export function totalA(orders: { price: number; quantity: number; discount: number }[]): number {
  let total = 0;
  for (const order of orders) {
    const gross = order.price * order.quantity;
    const net = gross - (gross * order.discount) / 100;
    total += Math.round(net * 100) / 100;
  }
  return total;
}
