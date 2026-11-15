declare module 'carbone' {
  const carbone: {
    render(
      path: string,
      data: Record<string, unknown>,
      options: { lang: string; timezone: string },
      callback: (error: Error | null, result: Buffer | string) => void,
    ): void;
  };
  export default carbone;
}
