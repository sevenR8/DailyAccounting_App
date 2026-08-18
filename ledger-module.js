export class LedgerModule {
  constructor(adapter) {
    this.adapter = adapter;
  }

  async provisionPersonalLedger({ userId, displayName }) {
    if (!userId) {
      throw new Error('必須提供使用者識別。');
    }

    const existingLedger = await this.adapter.findPersonalLedger(userId);
    if (existingLedger) {
      return existingLedger;
    }

    return this.adapter.createPersonalLedger({ ownerId: userId, displayName });
  }
}

