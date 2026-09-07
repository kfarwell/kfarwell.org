defmodule Kfarwell.AppleMusic do
  @moduledoc """
  Mints and caches the Apple Music developer token (an ES256 JWT).

  Apple caps them at six months, so one is signed from the private key at boot
  and re-signed before it lapses. The current token sits in ETS.
  """

  use GenServer

  require Logger

  @table :apple_music_token

  # Apple's cap is six months.
  @ttl 150 * 24 * 60 * 60

  @refresh_after div(@ttl, 3) * 1000

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "The current developer token, minting one if the cache is empty."
  @spec token() :: {:ok, String.t(), integer()} | {:error, term()}
  def token do
    case :ets.lookup(@table, :token) do
      [{:token, jwt, expires_at}] -> {:ok, jwt, expires_at}
      [] -> GenServer.call(__MODULE__, :refresh)
    end
  end

  @doc "Whether the app has credentials to sign tokens with."
  @spec configured?() :: boolean()
  def configured? do
    config = Application.get_env(:kfarwell, __MODULE__, [])

    config[:team_id] != nil and config[:key_id] != nil and private_key(config) != nil
  end

  @impl true
  def init(_opts) do
    :ets.new(@table, [:named_table, :set, :protected, read_concurrency: true])
    {:ok, %{}, {:continue, :mint}}
  end

  @impl true
  def handle_continue(:mint, state) do
    case mint() do
      {:ok, _jwt, _expires_at} ->
        :ok

      {:error, reason} ->
        Logger.warning("Apple Music token unavailable: #{inspect(reason)}")
    end

    Process.send_after(self(), :refresh, @refresh_after)
    {:noreply, state}
  end

  @impl true
  def handle_call(:refresh, _from, state) do
    {:reply, mint(), state}
  end

  @impl true
  def handle_info(:refresh, state) do
    {:noreply, state, {:continue, :mint}}
  end

  defp mint do
    config = Application.get_env(:kfarwell, __MODULE__, [])

    with {:ok, team_id} <- fetch(config, :team_id),
         {:ok, key_id} <- fetch(config, :key_id),
         {:ok, pem} <- fetch_private_key(config),
         {:ok, jwk} <- parse_key(pem) do
      issued_at = System.system_time(:second)
      expires_at = issued_at + @ttl

      claims =
        %{"iss" => team_id, "iat" => issued_at, "exp" => expires_at}
        |> put_origins(config[:origins])

      {_, jwt} =
        jwk
        |> JOSE.JWT.sign(%{"alg" => "ES256", "kid" => key_id}, claims)
        |> JOSE.JWS.compact()

      :ets.insert(@table, {:token, jwt, expires_at})
      Logger.info("Minted Apple Music developer token, expires #{expires_at}")
      {:ok, jwt, expires_at}
    else
      {:error, reason} ->
        # Credentials that have gone are most likely revoked.
        :ets.delete(@table, :token)
        {:error, reason}
    end
  end

  defp put_origins(claims, origins) when is_list(origins) and origins != [],
    do: Map.put(claims, "origin", origins)

  defp put_origins(claims, _origins), do: claims

  defp fetch(config, key) do
    case config[key] do
      nil -> {:error, {:missing, key}}
      value -> {:ok, value}
    end
  end

  defp fetch_private_key(config) do
    case private_key(config) do
      nil -> {:error, {:missing, :private_key}}
      pem -> {:ok, pem}
    end
  end

  defp private_key(config) do
    cond do
      is_binary(config[:private_key]) ->
        # Newlines often arrive escaped, from environments that can't hold them.
        String.replace(config[:private_key], "\\n", "\n")

      is_binary(config[:private_key_path]) ->
        case File.read(config[:private_key_path]) do
          {:ok, pem} -> pem
          {:error, _reason} -> nil
        end

      true ->
        nil
    end
  end

  defp parse_key(pem) do
    case JOSE.JWK.from_pem(pem) do
      %JOSE.JWK{} = jwk -> {:ok, jwk}
      other -> {:error, {:bad_private_key, other}}
    end
  end
end
