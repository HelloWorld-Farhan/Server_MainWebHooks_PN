const fs = require('fs');
let c = fs.readFileSync('src/modules/calls/campaign-execution.controller.ts', 'utf8');

c = c.replace(
  'const state = await getCampaignState(finalCompanyId);',
  'const type = (req.query.type as "live" | "reactivation") || "live";\n      const state = await getCampaignState(finalCompanyId, type);'
);
c = c.replace(
  'const state = await pauseCampaignState(finalCompanyId);',
  'const type = (req.body.type as "live" | "reactivation") || "live";\n      const state = await pauseCampaignState(finalCompanyId, type);'
);
c = c.replace(
  'const state = await resumeCampaignState(finalCompanyId);',
  'const type = (req.body.type as "live" | "reactivation") || "live";\n      const state = await resumeCampaignState(finalCompanyId, type);'
);
c = c.replace(
  'const state = await forceStopCampaignState(finalCompanyId);',
  'const type = (req.body.type as "live" | "reactivation") || "live";\n      const state = await forceStopCampaignState(finalCompanyId, type);'
);
c = c.replace(
  'await clearCampaignState(finalCompanyId);',
  'const type = (req.body.type as "live" | "reactivation") || "live";\n      await clearCampaignState(finalCompanyId, type);'
);

fs.writeFileSync('src/modules/calls/campaign-execution.controller.ts', c);
