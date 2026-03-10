import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function createHostMocks(url = '/v1/judge') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url, headers: {} }),
    }),
  } as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
  });

  it('should use string http exception responses as the message', () => {
    const { host, status, json } = createHostMocks('/string-error');

    filter.catch(new HttpException('plain error', HttpStatus.NOT_FOUND), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'NOT_FOUND',
        message: 'plain error',
        path: '/string-error',
      }),
    );
  });

  it('should fall back to the exception message when the http response body is null', () => {
    const { host, status, json } = createHostMocks('/null-body');
    const exception = new HttpException(null as never, HttpStatus.I_AM_A_TEAPOT);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.I_AM_A_TEAPOT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.I_AM_A_TEAPOT,
        error: 'I_AM_A_TEAPOT',
        message: exception.message,
        path: '/null-body',
      }),
    );
  });

  it('should join array message from object HttpException response', () => {
    const { host, status, json } = createHostMocks('/array-msg');
    const exception = new HttpException(
      { message: ['field1 is required', 'field2 must be a string'] },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'field1 is required; field2 must be a string',
      }),
    );
  });

  it('should use string message from object HttpException response', () => {
    const { host, status, json } = createHostMocks('/obj-msg');
    const exception = new HttpException(
      { message: 'custom object message', statusCode: 422 },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'custom object message',
      }),
    );
  });

  it('should convert unexpected errors into a 500 response and log them', () => {
    const { host, status, json } = createHostMocks('/boom');
    const loggerError = jest
      .spyOn(
        (filter as never as { logger: { error: (...args: unknown[]) => void } }).logger,
        'error',
      )
      .mockImplementation(() => {});

    filter.catch(new Error('boom'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
        path: '/boom',
      }),
    );
    expect(loggerError).toHaveBeenCalled();
  });

  it('should handle non-Error thrown values (e.g. strings)', () => {
    const { host, status, json } = createHostMocks('/string-throw');
    const loggerError = jest
      .spyOn(
        (filter as never as { logger: { error: (...args: unknown[]) => void } }).logger,
        'error',
      )
      .mockImplementation(() => {});

    filter.catch('raw string thrown', host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }),
    );
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('raw string thrown'));
  });

  it('should use "Unknown Error" for unrecognized status codes', () => {
    const { host, json } = createHostMocks('/unknown');
    const exception = new HttpException('weird', 599);

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 599,
        error: 'Unknown Error',
      }),
    );
  });

  it('should handle object response without message property', () => {
    const { host, json } = createHostMocks('/no-msg');
    const exception = new HttpException({ error: 'No message field' }, HttpStatus.FORBIDDEN);

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.FORBIDDEN,
        message: exception.message,
      }),
    );
  });
});
