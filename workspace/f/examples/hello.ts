// The smallest useful script: Windmill turns the parameters into a form and the return value into the result.
export async function main(name = "world") {
  return { greeting: `Hello, ${name}!`, at: new Date().toISOString() };
}
