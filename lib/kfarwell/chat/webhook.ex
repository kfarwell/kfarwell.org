defmodule Kfarwell.Chat.Webhook do
  @moduledoc """
  Posts visitors' messages under their own names.

  A bot can only post as itself; a webhook can set a name per message. Needs
  the Manage Webhooks permission — without it `handle/0` returns `:error` and
  the caller posts as the bot instead.
  """

  alias Kfarwell.Chat
  alias Nostrum.Api

  require Logger

  @name "kfarwell.org"
  @table :chat_webhook

  @doc "The webhook's id and token, creating the webhook on first use."
  @spec handle() :: {:ok, {Nostrum.Struct.Webhook.id(), String.t()}} | :error
  def handle do
    case :ets.lookup(@table, :webhook) do
      [{:webhook, id, token}] -> {:ok, {id, token}}
      [] -> discover()
    end
  end

  @doc false
  def init_table do
    :ets.new(@table, [:named_table, :set, :public, read_concurrency: true])
  end

  @doc """
  Sends a message into an existing thread as `username`.

  A `file` is `%{name: _, body: _}`, uploaded as an attachment.
  """
  @spec post(Nostrum.Struct.Channel.id(), String.t(), String.t(), map() | nil) ::
          {:ok, Nostrum.Struct.Message.t()} | {:error, term()} | :error
  def post(thread_id, content, username, file \\ nil) do
    execute(%{content: content, username: username, thread_id: thread_id}, file)
  end

  @doc """
  Opens a forum post as `username`.

  Executing a webhook against a forum channel with `thread_name` creates the
  post, so the very first message carries the visitor's name too.
  """
  @spec open(String.t(), String.t(), String.t(), map() | nil) ::
          {:ok, Nostrum.Struct.Message.t()} | {:error, term()} | :error
  def open(thread_name, content, username, file \\ nil) do
    execute(%{content: content, username: username, thread_name: thread_name}, file)
  end

  defp execute(args, file) do
    with {:ok, {id, token}} <- handle(),
         args = Map.put(args, :allowed_mentions, :none),
         args = if(file, do: Map.put(args, :file, file), else: args),
         {:ok, message} <- Api.Webhook.execute(id, token, args, true) do
      {:ok, message}
    else
      :error ->
        :error

      {:error, reason} ->
        Logger.warning("Webhook post failed: #{inspect(reason)}")
        # A deleted thread says nothing about the webhook, which belongs to
        # the channel.
        unless Kfarwell.Chat.thread_gone?(reason), do: forget()
        {:error, reason}
    end
  end

  # Discord only hands back tokens for webhooks we created ourselves.
  defp discover do
    with channel_id when is_integer(channel_id) <- Chat.forum_channel_id(),
         {:ok, webhooks} <- Api.Channel.webhooks(channel_id),
         {:ok, webhook} <- pick(webhooks, channel_id) do
      :ets.insert(@table, {:webhook, webhook.id, webhook.token})
      {:ok, {webhook.id, webhook.token}}
    else
      other ->
        Logger.info("No usable chat webhook (#{inspect(other)}); posting as the bot instead")
        :error
    end
  end

  defp pick(webhooks, channel_id) do
    case Enum.find(webhooks, &(&1.name == @name and &1.token != nil)) do
      nil -> Api.Webhook.create(channel_id, %{name: @name})
      webhook -> {:ok, webhook}
    end
  end

  defp forget, do: :ets.delete(@table, :webhook)
end
