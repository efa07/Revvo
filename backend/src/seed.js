import { hashPassword } from "./auth.js";

const PRODUCTS = [
  // name, category, size, price, original price (offer), slot, stock  (minor units: 7200 = ETB 72)
  ["Orange juice", "drinks", "300 ml", 7200, 8000, "A1", 12],
  ["Water", "drinks", "500 ml", 3500, null, "A2", 20],
  ["Cola", "drinks", "330 ml", 6500, null, "A3", 15],
  ["Potato chips", "snacks", "45 g", 6000, null, "B1", 10],
  ["Milk chocolate", "sweets", "45 g", 7000, null, "B2", 8],
  ["Biscuits", "sweets", "60 g", 4500, null, "B3", 0], // sold out on purpose
];

export async function seedDatabase(db, { adminPassword, staffPassword }) {
  const addUser = db.prepare(
    "INSERT OR IGNORE INTO users(username,password_hash,role) VALUES (?,?,?)",
  );
  addUser.run("admin", await hashPassword(adminPassword), "admin");
  addUser.run("staff", await hashPassword(staffPassword), "staff");
  if (db.prepare("SELECT COUNT(*) AS c FROM products").get().c === 0) {
    db.transaction(() => {
      for (const [name, category, size, price, list, slot, qty] of PRODUCTS) {
        const id = db
          .prepare(
            "INSERT INTO products(name,category,size_label,price_minor,list_price_minor,slot) VALUES (?,?,?,?,?,?)",
          )
          .run(name, category, size, price, list, slot).lastInsertRowid;
        db.prepare("INSERT INTO stock(product_id,quantity) VALUES (?,?)").run(
          id,
          qty,
        );
      }
    })();
  }
  db.prepare(
    "INSERT OR IGNORE INTO promo_codes(code, amount_off_minor) VALUES (?,?)",
  ).run("SAVE10", 1000);
}
