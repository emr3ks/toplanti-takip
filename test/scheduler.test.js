'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { testOrtami } = require('./helpers');
const { ayarlariKaydet } = require('../src/settings');
const { startZamanlayici } = require('../src/reminder');

test('zamanlayıcı ayarlara göre planlanır ve yeniden planlanır', async (t) => {
  const ortam = testOrtami();
  t.after(() => ortam.kapat());

  const planlar = [];
  const sahteCron = {
    schedule(ifade, islev, secenekler) {
      const gorev = {
        ifade,
        secenekler,
        islev,
        durduruldu: false,
        stop() {
          this.durduruldu = true;
        },
      };
      planlar.push(gorev);
      return gorev;
    },
  };
  const gunluk = { log() {}, error() {} };

  const zamanlayici = startZamanlayici({
    db: ortam.db,
    config: ortam.config,
    mailService: ortam.mailService,
    cronLib: sahteCron,
    log: gunluk,
  });

  assert.equal(planlar.length, 1);
  assert.equal(planlar[0].ifade, '0 9 * * *');
  assert.equal(planlar[0].secenekler.timezone, 'Europe/Istanbul');
  assert.equal(typeof planlar[0].islev, 'function');

  ayarlariKaydet(
    ortam.db,
    {
      hatirlatma_saati: '14:45',
      saat_dilimi: 'Europe/Berlin',
      test_modu: '1',
      rapor_alici: 'rapor@ornek.com',
    },
    ortam.config
  );

  zamanlayici.yenidenPlanla();
  assert.equal(planlar.length, 2);
  assert.equal(planlar[0].durduruldu, true);
  assert.equal(planlar[1].ifade, '45 14 * * *');
  assert.equal(planlar[1].secenekler.timezone, 'Europe/Berlin');

  zamanlayici.durdur();
  assert.equal(planlar[1].durduruldu, true);
  assert.equal(zamanlayici.gorevGetir(), null);
});
