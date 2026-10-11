// Generates a realistic demo dataset: 3 outlets, ~75 days of sales, purchases,
// stock counts, staff, shifts, expenses and licences. Deterministic per run date.
const { transaction } = require('./db');
const { makeGstin, computeBill, round2 } = require('./india/gst');
const { iso } = require('./india/compliance');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OUTLETS = [
  { code: 'KRM', name: 'Koramangala', city: 'Bengaluru', state: 'KA', state_code: '29', address: '80 Feet Road, 4th Block, Koramangala, Bengaluru 560034', pan: 'AAKCR4821M', seats: 70, rent: 350000, volume: 1.0 },
  { code: 'GCB', name: 'Gachibowli', city: 'Hyderabad', state: 'TS', state_code: '36', address: 'DLF Cyber City Road, Gachibowli, Hyderabad 500032', pan: 'AAKCR4821M', seats: 60, rent: 280000, volume: 0.85 },
  { code: 'ADH', name: 'Andheri West', city: 'Mumbai', state: 'MH', state_code: '27', address: 'Lokhandwala Complex, Andheri West, Mumbai 400053', pan: 'AAKCR4821M', seats: 55, rent: 450000, volume: 1.1 },
];

const CHANNELS = [
  { name: 'Dine-in', commission_pct: 0, is_aggregator: 0, share: 0.45 },
  { name: 'Takeaway', commission_pct: 0, is_aggregator: 0, share: 0.1 },
  { name: 'Swiggy', commission_pct: 22, is_aggregator: 1, share: 0.22 },
  { name: 'Zomato', commission_pct: 22, is_aggregator: 1, share: 0.2 },
  { name: 'ONDC', commission_pct: 8, is_aggregator: 1, share: 0.03 },
];

// [name, category, unit, cost (ex-GST), gst %, HSN, par level]
const ITEMS = [
  ['Basmati rice', 'Dry goods', 'kg', 110, 5, '1006', 40],
  ['Atta (wheat flour)', 'Dry goods', 'kg', 42, 5, '1101', 30],
  ['Maida', 'Dry goods', 'kg', 45, 5, '1101', 20],
  ['Rava (sooji)', 'Dry goods', 'kg', 50, 5, '1103', 8],
  ['Toor dal', 'Dry goods', 'kg', 150, 5, '0713', 10],
  ['Urad dal', 'Dry goods', 'kg', 140, 5, '0713', 15],
  ['Sugar', 'Dry goods', 'kg', 45, 5, '1701', 10],
  ['Cashew', 'Dry goods', 'kg', 900, 5, '0801', 3],
  ['Tea leaves', 'Dry goods', 'kg', 480, 5, '0902', 2],
  ['Garam masala', 'Spices', 'kg', 650, 5, '0910', 2],
  ['Red chilli powder', 'Spices', 'kg', 320, 5, '0904', 3],
  ['Turmeric powder', 'Spices', 'kg', 260, 5, '0910', 1],
  ['Paneer', 'Dairy', 'kg', 380, 0, '0406', 15],
  ['Curd', 'Dairy', 'kg', 70, 0, '0403', 20],
  ['Milk', 'Dairy', 'L', 58, 0, '0401', 40],
  ['Butter', 'Dairy', 'kg', 520, 5, '0405', 8],
  ['Ghee', 'Dairy', 'kg', 620, 5, '0405', 6],
  ['Fresh cream', 'Dairy', 'L', 240, 5, '0401', 6],
  ['Chicken (curry cut)', 'Meat', 'kg', 260, 0, '0207', 25],
  ['Chicken (boneless)', 'Meat', 'kg', 340, 0, '0207', 20],
  ['Mutton', 'Meat', 'kg', 750, 0, '0204', 12],
  ['Eggs', 'Meat', 'pcs', 7, 0, '0407', 120],
  ['Onion', 'Vegetables', 'kg', 35, 0, '0703', 50],
  ['Tomato', 'Vegetables', 'kg', 40, 0, '0702', 35],
  ['Potato', 'Vegetables', 'kg', 30, 0, '0701', 30],
  ['Green chilli', 'Vegetables', 'kg', 80, 0, '0709', 3],
  ['Coriander leaves', 'Vegetables', 'kg', 100, 0, '0709', 3],
  ['Lemon', 'Vegetables', 'pcs', 4, 0, '0805', 80],
  ['Coconut', 'Vegetables', 'pcs', 30, 0, '0801', 30],
  ['Ginger-garlic paste', 'Vegetables', 'kg', 140, 5, '2103', 8],
  ['Refined oil', 'Oils', 'L', 135, 5, '1512', 40],
];

// [name, category, veg, price, [[item, qty], ...]]
const MENU = [
  ['Paneer Tikka', 'Starters', 1, 260, [['Paneer', 0.15], ['Curd', 0.05], ['Refined oil', 0.02], ['Garam masala', 0.005], ['Red chilli powder', 0.005], ['Ginger-garlic paste', 0.01], ['Onion', 0.05], ['Lemon', 1]]],
  ['Chicken 65', 'Starters', 0, 280, [['Chicken (boneless)', 0.2], ['Refined oil', 0.05], ['Red chilli powder', 0.008], ['Ginger-garlic paste', 0.015], ['Curd', 0.03], ['Green chilli', 0.01]]],
  ['Chicken Tikka', 'Starters', 0, 300, [['Chicken (boneless)', 0.22], ['Curd', 0.06], ['Garam masala', 0.005], ['Red chilli powder', 0.006], ['Ginger-garlic paste', 0.015], ['Butter', 0.01], ['Lemon', 1]]],
  ['Veg Samosa (2 pcs)', 'Starters', 1, 80, [['Maida', 0.06], ['Potato', 0.12], ['Refined oil', 0.04], ['Garam masala', 0.003], ['Green chilli', 0.005]]],
  ['Paneer Butter Masala', 'Mains', 1, 290, [['Paneer', 0.15], ['Tomato', 0.15], ['Butter', 0.025], ['Fresh cream', 0.03], ['Cashew', 0.015], ['Garam masala', 0.004], ['Onion', 0.05]]],
  ['Dal Makhani', 'Mains', 1, 240, [['Urad dal', 0.08], ['Butter', 0.025], ['Fresh cream', 0.025], ['Tomato', 0.08], ['Ginger-garlic paste', 0.01]]],
  ['Butter Chicken', 'Mains', 0, 340, [['Chicken (boneless)', 0.22], ['Tomato', 0.15], ['Butter', 0.03], ['Fresh cream', 0.04], ['Cashew', 0.015], ['Garam masala', 0.004]]],
  ['Mutton Rogan Josh', 'Mains', 0, 420, [['Mutton', 0.25], ['Onion', 0.1], ['Curd', 0.05], ['Ghee', 0.02], ['Red chilli powder', 0.008], ['Garam masala', 0.005]]],
  ['Egg Curry', 'Mains', 0, 200, [['Eggs', 3], ['Onion', 0.1], ['Tomato', 0.1], ['Refined oil', 0.03], ['Turmeric powder', 0.003], ['Red chilli powder', 0.005]]],
  ['Chicken Dum Biryani', 'Biryani & Rice', 0, 320, [['Basmati rice', 0.15], ['Chicken (curry cut)', 0.25], ['Onion', 0.1], ['Curd', 0.05], ['Ghee', 0.02], ['Garam masala', 0.006], ['Coriander leaves', 0.01]]],
  ['Mutton Biryani', 'Biryani & Rice', 0, 450, [['Basmati rice', 0.15], ['Mutton', 0.22], ['Onion', 0.1], ['Curd', 0.05], ['Ghee', 0.025], ['Garam masala', 0.006]]],
  ['Veg Biryani', 'Biryani & Rice', 1, 250, [['Basmati rice', 0.15], ['Potato', 0.08], ['Paneer', 0.04], ['Onion', 0.08], ['Ghee', 0.015], ['Garam masala', 0.005]]],
  ['Jeera Rice', 'Biryani & Rice', 1, 160, [['Basmati rice', 0.12], ['Ghee', 0.01]]],
  ['Butter Naan', 'Breads', 1, 60, [['Maida', 0.09], ['Butter', 0.01], ['Curd', 0.01]]],
  ['Tandoori Roti', 'Breads', 1, 35, [['Atta (wheat flour)', 0.08]]],
  ['Lachha Paratha', 'Breads', 1, 70, [['Atta (wheat flour)', 0.1], ['Ghee', 0.012]]],
  ['Masala Dosa', 'South Indian', 1, 130, [['Basmati rice', 0.08], ['Urad dal', 0.03], ['Potato', 0.1], ['Onion', 0.04], ['Refined oil', 0.02], ['Coconut', 0.25]]],
  ['Idli Vada', 'South Indian', 1, 90, [['Basmati rice', 0.05], ['Urad dal', 0.04], ['Refined oil', 0.03], ['Toor dal', 0.03], ['Coconut', 0.2]]],
  ['Rava Upma', 'South Indian', 1, 80, [['Rava (sooji)', 0.08], ['Refined oil', 0.015], ['Onion', 0.03], ['Green chilli', 0.004]]],
  ['Masala Chai', 'Beverages', 1, 40, [['Milk', 0.12], ['Tea leaves', 0.005], ['Sugar', 0.012]]],
  ['Sweet Lassi', 'Beverages', 1, 90, [['Curd', 0.25], ['Sugar', 0.03]]],
  ['Fresh Lime Soda', 'Beverages', 1, 80, [['Lemon', 2], ['Sugar', 0.02]]],
  ['Gulab Jamun (2 pcs)', 'Desserts', 1, 90, [['Milk', 0.1], ['Maida', 0.02], ['Sugar', 0.06], ['Ghee', 0.02]]],
];

// Relative popularity per menu item (same order as MENU).
const POPULARITY = [7, 8, 5, 4, 9, 7, 10, 3, 2, 12, 4, 5, 3, 14, 8, 4, 6, 4, 2, 6, 4, 3, 4];

const VENDORS = [
  ['Sri Venkateswara Rice Traders', 'Dry goods', 'AFDPV2231K'],
  ['Nandini Dairy Distributors', 'Dairy', 'AAJFN7782Q'],
  ['FreshCuts Meats Pvt Ltd', 'Meat', 'AACCF5541H'],
  ['Mandi Fresh Vegetables', 'Vegetables', 'BQKPM9032L'],
  ['Everest Spice Agencies', 'Spices', 'AAHFE4410P'],
  ['Fortune Oils Wholesale', 'Oils', 'AADCF6627R'],
];

// [role, basic, hra, allowances, count, station]
const STAFF = [
  ['Restaurant Manager', 30000, 12000, 8000, 1, 'Floor'],
  ['Head Chef', 28000, 11000, 6000, 1, 'Kitchen'],
  ['Tandoor Chef', 13000, 5200, 2800, 1, 'Kitchen'],
  ['Commis Cook', 11000, 4400, 2600, 3, 'Kitchen'],
  ['Steward', 9000, 3600, 2400, 4, 'Floor'],
  ['Cashier', 10000, 4000, 2000, 1, 'Front desk'],
  ['Packing Associate', 8500, 3400, 2100, 1, 'Dispatch'],
  ['Kitchen Helper', 6500, 4500, 3000, 2, 'Kitchen'],
];

const FIRST = { M: ['Ravi', 'Suresh', 'Arjun', 'Mohammed', 'Prakash', 'Venkat', 'Imran', 'Rahul', 'Kiran', 'Manjunath', 'Sandeep', 'Deepak', 'Naveen', 'Sachin', 'Abdul', 'Ganesh'], F: ['Lakshmi', 'Priya', 'Ayesha', 'Kavya', 'Sunita', 'Divya', 'Meena', 'Fatima', 'Anjali', 'Shalini'] };
const LAST = ['Kumar', 'Reddy', 'Sharma', 'Naik', 'Patil', 'Khan', 'Rao', 'Gowda', 'Iyer', 'Shaikh', 'Yadav', 'Das', 'Pillai', 'Joshi'];

const addDays = (isoDate, n) => iso(new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86400000));
const weekday = (isoDate) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

function financialYear(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
}

function seed(db, { today = iso(new Date(Date.now() + 330 * 60000)), days = 75 } = {}) {
  const rand = rng(20261011);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const weighted = (weights) => {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rand() * total;
    for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return i;
    return weights.length - 1;
  };

  transaction(db, () => {
    const ins = (sql) => db.prepare(sql);
    const insOutlet = ins('INSERT INTO outlets (code,name,city,state,state_code,address,gstin,fssai_no,gst_scheme,seats) VALUES (?,?,?,?,?,?,?,?,?,?)');
    OUTLETS.forEach((o, i) => {
      o.id = Number(insOutlet.run(o.code, o.name, o.city, o.state, o.state_code, o.address, makeGstin(o.state_code, o.pan, String(i + 1)), `1${o.state_code}${String(19000000000 + i * 7731).slice(0, 11)}`, 'regular', o.seats).lastInsertRowid);
    });

    const insChannel = ins('INSERT INTO channels (name, commission_pct, is_aggregator) VALUES (?,?,?)');
    CHANNELS.forEach((c) => insChannel.run(c.name, c.commission_pct, c.is_aggregator));

    const itemByName = {};
    const insItem = ins('INSERT INTO inventory_items (name,category,unit,cost,gst_rate,hsn,par_level) VALUES (?,?,?,?,?,?,?)');
    ITEMS.forEach(([name, category, unit, cost, gst, hsn, par]) => {
      itemByName[name] = { id: Number(insItem.run(name, category, unit, cost, gst, hsn, par).lastInsertRowid), name, category, cost, gst, par };
    });

    const insMenu = ins('INSERT INTO menu_items (name,category,veg,price) VALUES (?,?,?,?)');
    const insRecipe = ins('INSERT INTO recipes (menu_item_id,item_id,qty) VALUES (?,?,?)');
    const menu = MENU.map(([name, category, veg, price, recipe]) => {
      const id = Number(insMenu.run(name, category, veg, price).lastInsertRowid);
      recipe.forEach(([item, qty]) => insRecipe.run(id, itemByName[item].id, qty));
      return { id, price, recipe: recipe.map(([item, qty]) => [itemByName[item], qty]) };
    });

    const insVendor = ins('INSERT INTO vendors (name,gstin,state_code,phone,category) VALUES (?,?,?,?,?)');
    const vendorsByOutletCategory = {};
    OUTLETS.forEach((o) => {
      VENDORS.forEach(([name, category, pan], vi) => {
        const id = Number(insVendor.run(`${name} (${o.city})`, makeGstin(o.state_code, pan), o.state_code, `+91 9${String(800000000 + vi * 1234567 + o.id * 9876).slice(0, 9)}`, category).lastInsertRowid);
        vendorsByOutletCategory[`${o.id}:${category}`] = id;
      });
    });

    // Employees.
    const insEmp = ins('INSERT INTO employees (outlet_id,code,name,role,gender,state,basic,hra,allowances,pf_enabled,pf_capped,uan,esic_no,phone,joined) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const employees = [];
    OUTLETS.forEach((o) => {
      let n = 1;
      STAFF.forEach(([role, basic, hra, allow, count, station]) => {
        for (let c = 0; c < count; c++) {
          const gender = role === 'Steward' || role === 'Cashier' || role === 'Commis Cook' ? (rand() < 0.4 ? 'F' : 'M') : rand() < 0.15 ? 'F' : 'M';
          const name = `${pick(FIRST[gender])} ${pick(LAST)}`;
          const fixed = basic + hra + allow;
          const id = Number(insEmp.run(
            o.id, `${o.code}-${String(n++).padStart(3, '0')}`, name, role, gender, o.state, basic, hra, allow, 1, 1,
            `10${Math.floor(1e9 + rand() * 8.9e9)}`, fixed <= 21000 ? `${o.state_code}00${Math.floor(1e11 + rand() * 8.9e11)}`.slice(0, 17) : '',
            `+91 ${Math.floor(7e9 + rand() * 2.9e9)}`, addDays(today, -Math.floor(60 + rand() * 1400)),
          ).lastInsertRowid);
          employees.push({ id, outlet: o, role, station });
        }
      });
    });

    // Shifts for the current and next week (Mon–Sun), one weekly off per person.
    const insShift = ins('INSERT INTO shifts (outlet_id,employee_id,date,start,end,station) VALUES (?,?,?,?,?,?)');
    const monday = addDays(today, -((weekday(today) + 6) % 7));
    employees.forEach((e, idx) => {
      const off = (idx * 3) % 7;
      const evening = idx % 2 === 1;
      for (let d = 0; d < 14; d++) {
        if (d % 7 === off) continue;
        const date = addDays(monday, d);
        const [start, end] = e.role === 'Restaurant Manager' ? ['11:00', '19:00'] : evening ? ['15:00', '23:00'] : ['08:00', '16:00'];
        insShift.run(e.outlet.id, e.id, date, start, end, e.station);
      }
    });

    // Licences, with a few expiring or lapsed to surface alerts.
    const insLic = ins('INSERT INTO licenses (outlet_id,type,number,authority,issued,expiry) VALUES (?,?,?,?,?,?)');
    const cityAuthority = { Bengaluru: 'BBMP', Hyderabad: 'GHMC', Mumbai: 'MCGM' };
    OUTLETS.forEach((o, i) => {
      const lic = [
        ['FSSAI Licence', `1${o.state_code}2${String(1e10 + i * 31337).slice(0, 11)}`, 'FSSAI (State)', -700, [400, 22, 160][i]],
        ['Shop & Establishment', `SE/${o.code}/2023/${4410 + i}`, `Labour Dept, ${STATE_NAME[o.state]}`, -900, 900],
        ['Trade Licence', `TL/${cityAuthority[o.city]}/${88120 + i}`, cityAuthority[o.city], -330, [35, 210, -4][i]],
        ['Fire NOC', `FIRE/${o.code}/${2024}/${117 + i}`, `${STATE_NAME[o.state]} Fire & Emergency Services`, -600, [130, 75, 300][i]],
        ['Eating House Licence', `EHL/${o.code}/${3301 + i}`, 'Commissioner of Police', -300, [65, 400, 58][i]],
        ['Signage Licence', `SIGN/${o.code}/${771 + i}`, cityAuthority[o.city], -200, [165, 12, 240][i]],
        ['Music Licence (PPL/IPRS)', `PPL/${o.code}/${9040 + i}`, 'PPL India', -340, [25, 90, 120][i]],
      ];
      lic.forEach(([type, number, authority, issuedOffset, expiryOffset]) => insLic.run(o.id, type, number, authority, addDays(today, issuedOffset), addDays(today, expiryOffset)));
    });

    // Day-by-day simulation of sales, consumption (with wastage), purchases and counts.
    const insOrder = ins('INSERT INTO orders (outlet_id,date,time,invoice_no,channel,payment_mode,covers,subtotal,discount,taxable,cgst,sgst,round_off,total,gst_by_eco,eco_gst) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const insLine = ins('INSERT INTO order_lines (order_id,menu_item_id,qty,price) VALUES (?,?,?,?)');
    const insPurchase = ins('INSERT INTO purchases (outlet_id,vendor_id,date,invoice_no,taxable,cgst,sgst,igst,total) VALUES (?,?,?,?,?,?,?,?,?)');
    const insPLine = ins('INSERT INTO purchase_lines (purchase_id,item_id,qty,rate,gst_rate) VALUES (?,?,?,?,?)');
    const updPurchase = ins('UPDATE purchases SET taxable=?, cgst=?, sgst=?, total=? WHERE id=?');
    const insCount = ins('INSERT INTO stock_counts (outlet_id,item_id,date,qty) VALUES (?,?,?,?)');
    const insExpense = ins('INSERT INTO expenses (outlet_id,date,category,amount,note) VALUES (?,?,?,?,?)');

    const start = addDays(today, -days);
    const items = Object.values(itemByName);
    const wasteFactor = Object.fromEntries(items.map((it) => [it.id, 1.01 + rand() * (it.category === 'Vegetables' || it.category === 'Meat' ? 0.09 : 0.04)]));
    const priceDrift = (cost) => round2(cost * (0.95 + rand() * 0.1));

    const consumedAll = Object.fromEntries(items.map((it) => [it.id, 0]));
    OUTLETS.forEach((o) => {
      const stock = Object.fromEntries(items.map((it) => [it.id, it.par * 1.5]));
      // Trailing consumption drives order quantities so busy items don't stock out.
      const consumed = Object.fromEntries(items.map((it) => [it.id, 0]));
      let invoiceSeq = 0;
      let poSeq = 0;
      const fy = financialYear(start);

      for (let d = 0; d <= days; d++) {
        const date = addDays(start, d);
        const dow = weekday(date);
        const isLast = d === days;

        // Purchases on Mondays and Thursdays: order up to ~5 days of cover (min 2x par).
        if (dow === 1 || dow === 4 || d === 0) {
          const byCategory = {};
          items.forEach((it) => {
            const daily = d ? consumed[it.id] / d : it.par;
            const target = Math.max(it.par * 2, daily * 5);
            if (stock[it.id] < target * 0.6) {
              const qty = target - stock[it.id];
              const rounded = it.category === 'Spices' || it.name === 'Cashew' || it.name === 'Tea leaves' ? Math.ceil(qty * 2) / 2 : Math.ceil(qty);
              (byCategory[it.category] ||= []).push([it, rounded]);
              stock[it.id] += rounded;
            }
          });
          Object.entries(byCategory).forEach(([category, lines]) => {
            const vendorId = vendorsByOutletCategory[`${o.id}:${category === 'Oils' ? 'Oils' : category}`];
            const pid = Number(insPurchase.run(o.id, vendorId, date, `INV/${o.code}/${String(++poSeq).padStart(4, '0')}`, 0, 0, 0, 0, 0).lastInsertRowid);
            let taxable = 0;
            let tax = 0;
            lines.forEach(([it, qty]) => {
              const rate = priceDrift(it.cost);
              insPLine.run(pid, it.id, qty, rate, it.gst);
              taxable += qty * rate;
              tax += (qty * rate * it.gst) / 100;
            });
            updPurchase.run(round2(taxable), round2(tax / 2), round2(tax / 2), round2(taxable + tax), pid);
          });
        }

        // Weekly stock count on Mondays and this morning, after deliveries and before service.
        if (dow === 1 || isLast) items.forEach((it) => insCount.run(o.id, it.id, date, round2(stock[it.id])));

        // Sales.
        const weekend = dow === 0 || dow === 6 || dow === 5;
        const orderCount = Math.round((100 + rand() * 40) * o.volume * (weekend ? 1.3 : 1));
        for (let k = 0; k < orderCount; k++) {
          const channel = CHANNELS[weighted(CHANNELS.map((c) => c.share))];
          const dineIn = channel.name === 'Dine-in';
          const lineCount = 1 + Math.floor(rand() * (dineIn ? 4 : 3));
          const lines = new Map();
          for (let l = 0; l < lineCount; l++) {
            const mi = weighted(POPULARITY);
            lines.set(mi, (lines.get(mi) || 0) + 1 + (rand() < 0.2 ? 1 : 0));
          }
          let subtotal = 0;
          lines.forEach((qty, mi) => { subtotal += menu[mi].price * qty; });
          const discountPct = channel.is_aggregator ? (rand() < 0.35 ? 0.1 : 0) : rand() < 0.08 ? 0.1 : 0;
          const discount = round2(subtotal * discountPct);
          const bill = computeBill({ subtotal, discount, channel: channel.name });
          const payment = channel.is_aggregator ? channel.name : ['UPI', 'UPI', 'UPI', 'Card', 'Cash'][Math.floor(rand() * 5)];
          const hour = rand() < 0.45 ? 12 + Math.floor(rand() * 3) : 19 + Math.floor(rand() * 4);
          const time = `${String(hour).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`;
          const covers = dineIn ? 1 + Math.floor(rand() * 4) : 0;
          const oid = Number(insOrder.run(o.id, date, time, `${o.code}/${fy}/${String(++invoiceSeq).padStart(6, '0')}`, channel.name, payment, covers,
            subtotal, discount, bill.taxable, bill.cgst, bill.sgst, bill.roundOff, bill.total, bill.gstByEco, bill.ecoGst).lastInsertRowid);
          lines.forEach((qty, mi) => {
            insLine.run(oid, menu[mi].id, qty, menu[mi].price);
            menu[mi].recipe.forEach(([it, rq]) => {
              const use = rq * qty * wasteFactor[it.id];
              consumed[it.id] += use;
              consumedAll[it.id] += use;
              stock[it.id] = Math.max(0, stock[it.id] - use);
            });
          });
        }

        // Operating expenses.
        const dom = Number(date.slice(8));
        if (dom === 1) insExpense.run(o.id, date, 'Rent', o.rent, 'Monthly lease rental');
        if (dom === 5) insExpense.run(o.id, date, 'Electricity', Math.round(95000 + rand() * 40000), 'Commercial power bill');
        if (dom === 7) insExpense.run(o.id, date, 'Water', Math.round(8000 + rand() * 4000), 'Water supply & tanker');
        if (dom === 10) insExpense.run(o.id, date, 'Marketing', Math.round(25000 + rand() * 20000), 'Aggregator ads & Instagram');
        if (dom === 15) insExpense.run(o.id, date, 'Housekeeping', 18000, 'Housekeeping contract');
        if (dow === 2) insExpense.run(o.id, date, 'LPG', Math.round((8 + Math.floor(rand() * 4)) * 1750), 'Commercial 19 kg cylinders');
        if (rand() < 0.08) insExpense.run(o.id, date, 'Repairs & Maintenance', Math.round(2000 + rand() * 12000), pick(['Tandoor repair', 'Exhaust cleaning', 'Refrigeration service', 'Plumbing', 'POS printer']));
      }
    });

    // Par level = about 1.5 days of average consumption per outlet.
    const updPar = ins('UPDATE inventory_items SET par_level = ? WHERE id = ?');
    items.forEach((it) => {
      const daily = consumedAll[it.id] / (days * OUTLETS.length);
      updPar.run(Math.max(1, it.unit === 'pcs' ? Math.ceil(daily * 1.5) : Math.ceil(daily * 1.5 * 2) / 2), it.id);
    });
  });
}

const STATE_NAME = { KA: 'Karnataka', TS: 'Telangana', MH: 'Maharashtra' };

module.exports = { seed, financialYear, addDays };
