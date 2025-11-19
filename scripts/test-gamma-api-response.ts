async function test() {
  const testId = '0000a3aa2ac9a909841538e97750d8cf5ef95fdf46b74a3d670e50771c58bbed';
  
  console.log(`Fetching: https://gamma-api.polymarket.com/markets?condition_id=${testId}\n`);
  
  const response = await fetch(`https://gamma-api.polymarket.com/markets?condition_id=${testId}`);
  const data = await response.json();
  
  console.log('Response length:', data.length);
  console.log('\nFirst market object:');
  console.log(JSON.stringify(data[0], null, 2));
}

test();
