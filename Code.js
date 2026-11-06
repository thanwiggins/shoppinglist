function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Product Tools')
    .addItem('Add Product', 'openProductForm')
    .addItem('Update Product', 'showEditProductDialog')
    .addToUi();
  ui.createMenu('List Tools')
    .addItem('Meal Planning','showMealSelectionForm')
    .addItem('Reset List', 'resetShoppingList')
    .addToUi();
}

function openProductForm() {
  var html = HtmlService.createHtmlOutputFromFile('ProductForm')
      .setWidth(400)
      .setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add New Product');
}

function appendProduct(product) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');

  sheet.appendRow([
    product.name,
    Number(product.price).toFixed(2),
    product.department
  ]);

  const newRow = sheet.getLastRow();

  if (newRow > 1) {
    const prevRow = newRow - 1;

    sheet.getRange(prevRow, 1, 1, sheet.getLastColumn())
      .copyTo(sheet.getRange(newRow, 1, 1, sheet.getLastColumn()), { formatOnly: true });

    sheet.getRange(prevRow, 7, 1, 3)
      .copyTo(sheet.getRange(newRow, 7, 1, 3), { contentsOnly: false });
  }

  sortSheet(sheet);
}

function sortSheet(sheet) {
  var lastRow = sheet.getLastRow();
  
  if (lastRow > 1) {
    var range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
    range.sort({ column: 1, ascending: true });
  }
}

function showEditProductDialog() {
  var html = HtmlService.createHtmlOutputFromFile('EditProductForm')
    .setWidth(400)
    .setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, 'Edit Product');
}

function getProductList() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');
  var products = sheet.getRange('A2:A' + sheet.getLastRow()).getValues();
  return products.flat().filter(String);
}

function getProductDetails(productName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === productName) {
      return { price: data[i][1], department: data[i][2] };
    }
  }
  return null;
}

function updateProduct(productName, newPrice, newDepartment) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === productName) {
      if (newPrice !== '') sheet.getRange(i + 1, 2).setValue(newPrice);
      if (newDepartment !== '') sheet.getRange(i + 1, 3).setValue(newDepartment);
      return 'Product updated successfully!';
    }
  }
  return 'Product not found!';
}

function showMealSelectionForm() {
  sortMeals();
  var htmlTemplate = HtmlService.createHtmlOutputFromFile('MealSelectionForm')
    .setWidth(700)
    .setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(htmlTemplate, 'Select Your Meals');
}

function processMealSelection(formData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dinnerDataSheet = ss.getSheetByName('Dinnerdata');
  var mealSelections = formData.meals;

  for (var i = 0; i < mealSelections.length; i++) {
    dinnerDataSheet.getRange(i + 2, 3).setValue(mealSelections[i]);
  }

  var listBuilderSheet = ss.getSheetByName('List Builder');
  var itemsToCopy = dinnerDataSheet.getRange('B2:B51').getValues();
  listBuilderSheet.getRange(8, 13, itemsToCopy.length, 1).setValues(itemsToCopy);

}

function getMealOptionsWithPrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Meals');
  var mealNames = sheet.getRange('A2:A').getValues();
  var mealPrices = sheet.getRange('B2:B').getValues();
  var meals = [];
  
  for (var i = 0; i < mealNames.length; i++) {
    if (mealNames[i][0]) { 
      meals.push({ name: mealNames[i][0], price: mealPrices[i][0] });
    }
  }
  Logger.log('Meals array: %s', JSON.stringify(meals));

  return meals;
}

function checkbox() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var cell = sheet.getActiveCell();
  var range = cell.getA1Notation();
  
  sheet.getRange(range).insertCheckboxes();
}

function resetShoppingList() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  const shoppingListSheet = ss.getSheetByName('Shopping List');
  const listBuilderSheet = ss.getSheetByName('List Builder');
  const productsSheet = ss.getSheetByName('Products');

  if (!shoppingListSheet || !listBuilderSheet || !productsSheet) {
    ui.alert("Missing one or more required sheets: 'Shopping List', 'List Builder', 'Products'.");
    return;
  }

  const prompt = ui.prompt(
    'Last shopping trip date',
    'Enter the date of your last shopping trip.\n\nAccepted formats (examples):\n• 2026-01-29 (YYYY-MM-DD)\n• 01/29/2026 (MM/DD/YYYY)\n• 1/29/2026 (M/D/YYYY)\n',
    ui.ButtonSet.OK_CANCEL
  );

  if (prompt.getSelectedButton() !== ui.Button.OK) return;

  const dateInput = (prompt.getResponseText() || '').trim();
  const tripDate = parseUserDate_(dateInput);
  if (!tripDate) {
    ui.alert('Sorry, I could not understand that date. Please use one of the example formats shown in the prompt.');
    return;
  }

  const productRanges = ['A6:A55', 'E6:E55', 'I6:I55', 'M6:M55'];
  const qtyRanges     = ['C6:C55', 'G6:G55', 'K6:K55', 'O6:O55'];

  const lastProdRow = Math.max(2, productsSheet.getLastRow());
  const prodNames = productsSheet.getRange(2, 1, lastProdRow - 1, 1).getValues();
  const productToRow = new Map();
  for (let i = 0; i < prodNames.length; i++) {
    const name = (prodNames[i][0] || '').toString();
    if (name) productToRow.set(name, i + 2);
  }

  for (let b = 0; b < productRanges.length; b++) {
    const productVals = listBuilderSheet.getRange(productRanges[b]).getValues();
    const qtyVals = listBuilderSheet.getRange(qtyRanges[b]).getValues();

    for (let r = 0; r < productVals.length; r++) {
      const product = (productVals[r][0] || '').toString();
      const qty = Number(qtyVals[r][0]);

      if (!product) continue;
      if (!(qty > 0)) continue; // strictly > 0 only

      const prodRow = productToRow.get(product);
      if (!prodRow) {
        ui.alert(
          "Couldn't find a matching product in Products!A2:A for:\n\n" +
          product +
          "\n\nNo changes were made and the reset was cancelled."
        );
        return;
      }

      const defRange = productsSheet.getRange(prodRow, 4, 1, 3); // D:F
      const oldDEF = defRange.getValues()[0]; // [D, E, F]

      const newD = tripDate;
      const newE = oldDEF[0]; // old D
      const newF = oldDEF[1]; // old E

      defRange.setValues([[newD, newE, newF]]);
    }
  }

  shoppingListSheet.getRange('A9:A108').setValue(false);

  const clearRanges = ['C6:C55', 'G6:G55', 'K6:K55', 'O6:O55'];
  clearRanges.forEach(a1 => listBuilderSheet.getRange(a1).clearContent());

  const unprotectedRanges = ['A9:A55', 'E21:E55', 'I32:I55', 'M8:M55'];
  unprotectedRanges.forEach(a1 => listBuilderSheet.getRange(a1).clearContent());

  ui.alert('The Shopping List has been reset and purchase history was updated.');
}

function parseUserDate_(s) {
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    return isSameYMD_(dt, y, mo, d) ? dt : null;
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mo = Number(m[1]), d = Number(m[2]), y = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    return isSameYMD_(dt, y, mo, d) ? dt : null;
  }

  const t = Date.parse(s);
  if (!isNaN(t)) {
    const dt = new Date(t);
    return dt;
  }

  return null;
}

function isSameYMD_(dt, y, mo, d) {
  return (
    dt &&
    dt.getFullYear() === y &&
    dt.getMonth() === (mo - 1) &&
    dt.getDate() === d
  );
}

function sortMeals() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Meals');
  var range = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn());
  
  range.sort({column: 2, ascending: true}); 
}